// Copyright 2019 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

Resources.BackgroundServiceView = class extends UI.VBox {
  /**
   * @param {!Protocol.BackgroundService.ServiceName} serviceName
   * @param {!Resources.BackgroundServiceModel} model
   */
  constructor(serviceName, model) {
    super(true);
    this.registerRequiredCSS('resources/backgroundServiceView.css');

    /** @const {!Protocol.BackgroundService.ServiceName} */
    this._serviceName = serviceName;

    /** @const {!Resources.BackgroundServiceModel} */
    this._model = model;
    this._model.addEventListener(
        Resources.BackgroundServiceModel.Events.RecordingStateChanged, this._onRecordingStateChanged, this);
    this._model.addEventListener(
        Resources.BackgroundServiceModel.Events.BackgroundServiceEventReceived, this._onEventReceived, this);
    this._model.enable(this._serviceName);

    /** @const {?SDK.ServiceWorkerManager} */
    this._serviceWorkerManager = this._model.target().model(SDK.ServiceWorkerManager);

    /** @const {?SDK.SecurityOriginManager} */
    this._securityOriginManager = this._model.target().model(SDK.SecurityOriginManager);
    this._securityOriginManager.addEventListener(
        SDK.SecurityOriginManager.Events.MainSecurityOriginChanged, () => this._onOriginChanged());

    /** @type {?UI.ToolbarToggle} */
    this._recordButton = null;

    /** @type {?UI.ToolbarCheckbox} */
    this._originCheckbox = null;

    /** @const {!UI.Toolbar} */
    this._toolbar = new UI.Toolbar('background-service-toolbar', this.contentElement);
    this._setupToolbar();

    /** @const {!DataGrid.DataGrid} */
    this._dataGrid = this._createDataGrid();
    this._dataGrid.asWidget().show(this.contentElement);
  }

  /**
   * Creates the toolbar UI element.
   */
  async _setupToolbar() {
    this._recordButton =
        new UI.ToolbarToggle(Common.UIString('Toggle Record'), 'largeicon-start-recording', 'largeicon-stop-recording');
    this._recordButton.addEventListener(UI.ToolbarButton.Events.Click, () => this._toggleRecording());
    this._recordButton.setToggleWithRedColor(true);
    this._toolbar.appendToolbarItem(this._recordButton);

    const refreshButton = new UI.ToolbarButton(Common.UIString('Refresh'), 'largeicon-refresh');
    refreshButton.addEventListener(UI.ToolbarButton.Events.Click, () => this._refreshView());
    this._toolbar.appendToolbarItem(refreshButton);

    const clearButton = new UI.ToolbarButton(Common.UIString('Clear'), 'largeicon-clear');
    clearButton.addEventListener(UI.ToolbarButton.Events.Click, () => this._clearView());
    this._toolbar.appendToolbarItem(clearButton);

    this._toolbar.appendSeparator();

    const deleteButton = new UI.ToolbarButton(Common.UIString('Delete'), 'largeicon-trash-bin');
    deleteButton.addEventListener(UI.ToolbarButton.Events.Click, () => this._deleteEvents());
    this._toolbar.appendToolbarItem(deleteButton);

    this._toolbar.appendSeparator();

    this._originCheckbox =
        new UI.ToolbarCheckbox(Common.UIString('Show events from other domains'), undefined, () => this._refreshView());
    this._toolbar.appendToolbarItem(this._originCheckbox);
  }

  /**
   * Called when the `Toggle Record` button is clicked.
   */
  _toggleRecording() {
    this._model.setRecording(!this._recordButton.toggled(), this._serviceName);
  }

  /**
   * Called when the `Refresh` button is clicked.
   */
  _refreshView() {
    this._clearView();
    const events = this._model.getEvents(this._serviceName).filter(event => this._acceptEvent(event));
    for (const event of events)
      this._addEvent(event);
  }

  /**
   * Called when the `Clear` button is clicked.
   */
  _clearView() {
    this._dataGrid.rootNode().removeChildren();
  }

  /**
   * Called when the `Delete` button is clicked.
   */
  _deleteEvents() {
    this._model.clearEvents(this._serviceName);
    this._clearView();
  }

  /**
   * @param {!Common.Event} event
   */
  _onRecordingStateChanged(event) {
    const state = /** @type {!Resources.BackgroundServiceModel.RecordingState} */ (event.data);
    if (state.serviceName !== this._serviceName)
      return;
    this._recordButton.setToggled(state.isRecording);
  }

  /**
   * @param {!Common.Event} event
   */
  _onEventReceived(event) {
    const serviceEvent = /** @type {!Protocol.BackgroundService.BackgroundServiceEvent} */ (event.data);
    if (!this._acceptEvent(serviceEvent))
      return;
    this._addEvent(serviceEvent);
  }

  _onOriginChanged() {
    // No need to refresh the view if we are already showing all events.
    if (this._originCheckbox.checked())
      return;
    this._refreshView();
  }

  /**
   * @param {!Protocol.BackgroundService.BackgroundServiceEvent} serviceEvent
   */
  _addEvent(serviceEvent) {
    const data = this._createEventData(serviceEvent);
    const dataNode = new Resources.BackgroundServiceView.EventDataNode(data, serviceEvent.eventMetadata);
    this._dataGrid.rootNode().appendChild(dataNode);
  }

  /**
   * @return {!DataGrid.DataGrid}
   */
  _createDataGrid() {
    const columns = /** @type {!Array<!DataGrid.DataGrid.ColumnDescriptor>} */ ([
      {id: 'id', title: Common.UIString('#'), weight: 1},
      {id: 'timestamp', title: Common.UIString('Timestamp'), weight: 8},
      {id: 'origin', title: Common.UIString('Origin'), weight: 10},
      {id: 'swSource', title: Common.UIString('SW Source'), weight: 4},
      {id: 'eventName', title: Common.UIString('Event'), weight: 10},
      {id: 'instanceId', title: Common.UIString('Instance ID'), weight: 10},
    ]);
    const dataGrid = new DataGrid.DataGrid(columns);
    dataGrid.setStriped(true);
    return dataGrid;
  }

  /**
   * Creates the data object to pass to the DataGrid Node.
   * @param {!Protocol.BackgroundService.BackgroundServiceEvent} serviceEvent
   * @return {!Resources.BackgroundServiceView.EventData}
   */
  _createEventData(serviceEvent) {
    let swSource = '';

    // Try to get the script name of the Service Worker registration to be more user-friendly.
    const registrations = this._serviceWorkerManager.registrations().get(serviceEvent.serviceWorkerRegistrationId);
    if (registrations && registrations.versions.size) {
      // Any version will do since we care about the script URL.
      const version = registrations.versions.values().next().value;
      // Get the relative path.
      swSource = version.scriptURL.substr(version.securityOrigin.length);
    }

    return {
      id: this._dataGrid.rootNode().children.length,
      timestamp: UI.formatTimestamp(serviceEvent.timestamp * 1000, /* full= */ true),
      origin: serviceEvent.origin,
      swSource,
      eventName: serviceEvent.eventName,
      instanceId: serviceEvent.instanceId,
    };
  }

  /**
   * Filtration function to know whether event should be shown or not.
   * @param {!Protocol.BackgroundService.BackgroundServiceEvent} event
   * @return {boolean}
   */
  _acceptEvent(event) {
    if (event.service !== this._serviceName)
      return false;

    if (this._originCheckbox.checked())
      return true;

    // Trim the trailing '/'.
    const origin = event.origin.substr(0, event.origin.length - 1);

    return this._securityOriginManager.securityOrigins().includes(origin);
  }
};

/**
 * @typedef {{
 *    id: number,
 *    timestamp: string,
 *    origin: string,
 *    swSource: string,
 *    eventName: string,
 *    instanceId: string,
 * }}
 */
Resources.BackgroundServiceView.EventData;

Resources.BackgroundServiceView.EventDataNode = class extends DataGrid.DataGridNode {
  /**
   * @param {!Object<string, string>} data
   * @param {!Array<!Protocol.BackgroundService.EventMetadata>} eventMetadata
   */
  constructor(data, eventMetadata) {
    super(data);

    /** @const {!Array<!Protocol.BackgroundService.EventMetadata>} */
    this._eventMetadata = eventMetadata;

    /** @type {?UI.PopoverHelper} */
    this._popoverHelper = null;
  }

  /**
   * @override
   * @return {!Element}
   */
  createElement() {
    const element = super.createElement();

    this._popoverHelper = new UI.PopoverHelper(element, event => this._createPopover(event));
    this._popoverHelper.setHasPadding(true);
    this._popoverHelper.setTimeout(300, 300);

    return element;
  }

  /**
   * @param {!Event} event
   * @return {?UI.PopoverRequest}
   */
  _createPopover(event) {
    if (event.type !== 'mousedown')
      return null;

    // Create popover container.
    const container = createElementWithClass('div', 'background-service-popover-container');
    UI.appendStyle(container, 'resources/backgroundServiceView.css');

    if (!this._eventMetadata.length) {
      const entryDiv = createElementWithClass('div', 'background-service-metadata-entry');
      entryDiv.textContent = 'There is no metadata for this event';
      container.appendChild(entryDiv);
    }

    for (const entry of this._eventMetadata) {
      const entryDiv = createElementWithClass('div', 'background-service-metadata-entry');
      const key = createElementWithClass('label', 'background-service-metadata-key');
      key.textContent = `${entry.key}: `;
      const value = createElementWithClass('label', 'background-service-metadata-value');
      value.textContent = entry.value;
      entryDiv.appendChild(key);
      entryDiv.appendChild(value);
      container.appendChild(entryDiv);
    }

    return {
      box: event.target.boxInWindow(),
      show: popover => {
        popover.contentElement.appendChild(container);
        return Promise.resolve(true);
      },
    };
  }
};
