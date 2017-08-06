(function () {
  var ns = $.namespace('pskl.selection');

  var SELECTION_REPLAY = {
    PASTE : 'REPLAY_PASTE',
    ERASE : 'REPLAY_ERASE'
  };

  ns.SelectionManager = function (piskelController) {

    this.piskelController = piskelController;

    this.currentSelection = null;
  };

  ns.SelectionManager.prototype.init = function () {
    $.subscribe(Events.SELECTION_CREATED, $.proxy(this.onSelectionCreated_, this));
    $.subscribe(Events.SELECTION_DISMISSED, $.proxy(this.onSelectionDismissed_, this));
    $.subscribe(Events.SELECTION_MOVE_REQUEST, $.proxy(this.onSelectionMoved_, this));
    $.subscribe(Events.SELECTION_COPY, this.copy.bind(this));
    $.subscribe(Events.SELECTION_CUT, this.cut.bind(this));
    $.subscribe(Events.SELECTION_PASTE, this.paste.bind(this));

    var shortcuts = pskl.service.keyboard.Shortcuts;
    pskl.app.shortcutService.registerShortcut(shortcuts.SELECTION.DELETE, this.onDeleteShortcut_.bind(this));
    pskl.app.shortcutService.registerShortcut(shortcuts.SELECTION.COMMIT, this.commit.bind(this));

    // These 3 events should be handled by a new separated service
    window.addEventListener('cut', this.cut.bind(this), true);
    window.addEventListener('copy', this.copy.bind(this), true);
    window.addEventListener('paste', this.paste.bind(this), true);

    $.subscribe(Events.TOOL_SELECTED, $.proxy(this.onToolSelected_, this));
  };

  /**
   * @private
   */
  ns.SelectionManager.prototype.cleanSelection_ = function() {
    if (this.currentSelection) {
      this.currentSelection.reset();
      this.currentSelection = null;
    }
  };

  /**
   * @private
   */
  ns.SelectionManager.prototype.onToolSelected_ = function(evt, tool) {
    var isSelectionTool = tool instanceof pskl.tools.drawing.selection.BaseSelect;
    if (!isSelectionTool) {
      this.cleanSelection_();
    }
  };

  /**
   * @private
   */
  ns.SelectionManager.prototype.onSelectionDismissed_ = function(evt) {
    this.cleanSelection_();
  };

  ns.SelectionManager.prototype.onDeleteShortcut_ = function(evt) {
    if (this.currentSelection) {
      this.erase();
    } else {
      return true; // bubble
    }
  };

  ns.SelectionManager.prototype.erase = function () {
    var pixels = this.currentSelection.pixels;
    var currentFrame = this.piskelController.getCurrentFrame();
    for (var i = 0, l = pixels.length ; i < l ; i++) {
      currentFrame.setPixel(pixels[i].col, pixels[i].row, Constants.TRANSPARENT_COLOR);
    }

    $.publish(Events.PISKEL_SAVE_STATE, {
      type : pskl.service.HistoryService.REPLAY,
      scope : this,
      replay : {
        type : SELECTION_REPLAY.ERASE,
        pixels : JSON.parse(JSON.stringify(pixels.slice(0)))
      }
    });
  };

  ns.SelectionManager.prototype.copy = function(event) {
    // TODO the copy method in this file should not rely on a copy event, it should simply update the current selection
    if (this.currentSelection && this.piskelController.getCurrentFrame()) {
      this.currentSelection.fillSelectionFromFrame(this.piskelController.getCurrentFrame());
      event.clipboardData.setData('text/plain', JSON.stringify(this.currentSelection));
      event.preventDefault();
    }
  };

  ns.SelectionManager.prototype.cut = function(event) {
    // TODO the copy method in this file should not rely on a copy event, it should simply update the current selection
    if (this.currentSelection && this.piskelController.getCurrentFrame()) {
      // Put cut target into the selection:
      this.currentSelection.fillSelectionFromFrame(this.piskelController.getCurrentFrame());
      event.clipboardData.setData('text/plain', JSON.stringify(this.currentSelection));
      event.preventDefault();
      this.erase();
    }
  };

  ns.SelectionManager.prototype.paste = function() {
    var items = event.clipboardData.items;

    var blob;
    for (var i = 0 ; i < items.length ;i++) {
      if (/^image/i.test(items[i].type)) {
        blob = items[i].getAsFile();
        break;
      }
    }

    if (blob) {
      pskl.utils.FileUtils.readImageFile(blob, function (image) {
        // TODO: really hacky need to extract the "on image loaded" logic somewhere else
        pskl.app.fileDropperService.dropPosition_ = {x: 0, y: 0};
        pskl.app.fileDropperService.onImageLoaded_(image, blob);
      }.bind(this));
      event.stopPropagation();
      return;
    } else {
      console.log('Your clipboard doesn\'t contain any image');
    }


    if (!this.currentSelection || !this.currentSelection.hasPastedContent) {
      var pastedContent;
      for (var i = 0 ; i < items.length ;i++) {
        if (/^text\/plain/i.test(items[i].type)) {
          pastedContent = items[i].getData('text/plain');
          break;
        }
      }
      if (pastedContent) {
        this.currentSelection = JSON.parse(pastedContent);
      } else {
        // Allow the event
        return;
      }
    }

    var pixels = this.currentSelection.pixels;
    var frame = this.piskelController.getCurrentFrame();

    this.pastePixels_(frame, pixels);

    $.publish(Events.PISKEL_SAVE_STATE, {
      type : pskl.service.HistoryService.REPLAY,
      scope : this,
      replay : {
        type : SELECTION_REPLAY.PASTE,
        pixels : JSON.parse(JSON.stringify(pixels.slice(0)))
      }
    });
  };

  /**
   * If the currently selected tool is a selection tool, call commitSelection handler on
   * the current tool instance.
   */
  ns.SelectionManager.prototype.commit = function() {
    var tool = pskl.app.drawingController.currentToolBehavior;
    var isSelectionTool = tool instanceof pskl.tools.drawing.selection.BaseSelect;
    if (isSelectionTool) {
      var overlay = pskl.app.drawingController.overlayFrame;
      tool.commitSelection(overlay);
    }
  };

  ns.SelectionManager.prototype.replay = function (frame, replayData) {
    if (replayData.type === SELECTION_REPLAY.PASTE) {
      this.pastePixels_(frame, replayData.pixels);
    } else if (replayData.type === SELECTION_REPLAY.ERASE) {
      replayData.pixels.forEach(function (pixel) {
        frame.setPixel(pixel.col, pixel.row, Constants.TRANSPARENT_COLOR);
      });
    }
  };

  ns.SelectionManager.prototype.pastePixels_ = function(frame, pixels) {
    pixels.forEach(function (pixel) {
      if (pixel.color === Constants.TRANSPARENT_COLOR || pixel.color === null) {
        return;
      }
      frame.setPixel(pixel.col, pixel.row, pixel.color);
    });
  };

  /**
   * @private
   */
  ns.SelectionManager.prototype.onSelectionCreated_ = function(evt, selection) {
    if (selection) {
      this.currentSelection = selection;
    } else {
      console.error('No selection provided to SelectionManager');
    }
  };

  /**
   * @private
   */
  ns.SelectionManager.prototype.onSelectionMoved_ = function(evt, colDiff, rowDiff) {
    if (this.currentSelection) {
      this.currentSelection.move(colDiff, rowDiff);
    } else {
      console.error('Bad state: No currentSelection set when trying to move it in SelectionManager');
    }
  };
})();
