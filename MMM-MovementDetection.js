Module.register("MMM-MovementDetection", {
  defaults: {
    inactivityTimeoutMs: 5 * 60 * 1000,
    checkIntervalMs: 1000,
    captureWidth: 160,
    captureHeight: 120,
    downSampleStride: 4,
    pixelDifferenceThreshold: 28,
    changedPixelRatioThreshold: 0.06,
    movementLogCooldownMs: 30000,
    dimBrightness: 0.2,
    dimTargetSelector: "body",
    logFileName: "data/movement-events.jsonl",
    stateFileName: "data/movement-state.json",
    camera: {
      facingMode: "user",
      width: { ideal: 640 },
      height: { ideal: 480 },
      frameRate: { ideal: 10, max: 15 }
    },
    showModuleStatus: true,
    showLastMovement: true,
    showIdleSummary: true,
    statusRefreshMs: 10000,
    debug: false
  },

  requiresVersion: "2.1.0",

  start: function () {
    this.lastMovementAt = null;
    this.lastActivityAt = null;
    this.lastLoggedMovementAt = null;
    this.currentMotionRatio = 0;
    this.cameraError = null;
    this.storageError = null;
    this.cameraReady = false;
    this.monitoringStarted = false;
    this.isDimmed = false;
    this.sampleTimer = null;
    this.renderTimer = null;
    this.videoElement = null;
    this.canvasElement = null;
    this.canvasContext = null;
    this.previousFrame = null;
    this.stream = null;
    this.lastMotionStats = null;

    this.sendSocketNotification("INIT", {
      identifier: this.identifier,
      config: {
        logFileName: this.config.logFileName,
        stateFileName: this.config.stateFileName
      }
    });
  },

  getStyles: function () {
    return ["MMM-MovementDetection.css"];
  },

  getDom: function () {
    const wrapper = document.createElement("div");
    wrapper.className = "mmm-movement-detection";

    const statusLabel = this.getStatusLabel();

    const header = document.createElement("div");
    header.className = "mmm-movement-detection__header";

    const title = document.createElement("div");
    title.className = "mmm-movement-detection__title";
    title.textContent = "Movement monitor";
    header.appendChild(title);

    const badge = document.createElement("span");
    badge.className = `mmm-movement-detection__badge ${this.getStatusClassName()}`;
    badge.textContent = statusLabel;
    header.appendChild(badge);

    wrapper.appendChild(header);

    if (this.config.debug) {
      const headline = document.createElement("div");
      headline.className = "mmm-movement-detection__headline";
      headline.textContent = this.getHeadlineText();
      wrapper.appendChild(headline);

      const description = document.createElement("div");
      description.className = "mmm-movement-detection__description";
      description.textContent = this.getDescriptionText();
      wrapper.appendChild(description);
    }

    if (this.config.debug && this.config.showModuleStatus) {
      const statusRow = document.createElement("div");
      statusRow.className = "mmm-movement-detection__row";

      const statusChip = document.createElement("span");
      statusChip.className = `mmm-movement-detection__chip ${this.getStatusClassName()}`;
      statusChip.textContent = statusLabel;

      const cameraState = document.createElement("span");
      cameraState.className = "mmm-movement-detection__meta";
      cameraState.textContent = this.getCameraStateLabel();

      statusRow.appendChild(statusChip);
      statusRow.appendChild(cameraState);
      wrapper.appendChild(statusRow);
    }

    if (this.config.showLastMovement) {
      const movementRow = document.createElement("div");
      movementRow.className = "mmm-movement-detection__row";

      const label = document.createElement("span");
      label.className = "mmm-movement-detection__label";
      label.textContent = "Last seen";

      const value = document.createElement("span");
      value.className = "mmm-movement-detection__value";
      value.textContent = this.formatLastMovement();

      movementRow.appendChild(label);
      movementRow.appendChild(value);
      wrapper.appendChild(movementRow);
    }

    if (this.config.debug && this.config.showIdleSummary) {
      const idleRow = document.createElement("div");
      idleRow.className = "mmm-movement-detection__row";

      const label = document.createElement("span");
      label.className = "mmm-movement-detection__label";
      label.textContent = "Idle timeout";

      const value = document.createElement("span");
      value.className = "mmm-movement-detection__value";
      value.textContent = `${this.formatDuration(this.config.inactivityTimeoutMs)} (${this.getIdleStateLabel()})`;

      idleRow.appendChild(label);
      idleRow.appendChild(value);
      wrapper.appendChild(idleRow);
    }

    if (this.config.debug) {
      const detailsPanel = document.createElement("div");
      detailsPanel.className = "mmm-movement-detection__details";

      const detailsTitle = document.createElement("div");
      detailsTitle.className = "mmm-movement-detection__details-title";
      detailsTitle.textContent = "Debug details";
      detailsPanel.appendChild(detailsTitle);

      const cameraConfig = this.config.camera || {};
      const cameraWidth = cameraConfig.width && typeof cameraConfig.width.ideal !== "undefined" ? cameraConfig.width.ideal : "?";
      const cameraHeight = cameraConfig.height && typeof cameraConfig.height.ideal !== "undefined" ? cameraConfig.height.ideal : "?";
      const frameRate = cameraConfig.frameRate && typeof cameraConfig.frameRate.ideal !== "undefined" ? cameraConfig.frameRate.ideal : "?";

      const details = [
        ["Motion ratio", this.lastMotionStats ? this.currentMotionRatio.toFixed(4) : "0.0000"],
        ["Sampled / changed", this.getSampleSummary()],
        ["Thresholds", `${this.config.changedPixelRatioThreshold} ratio, ${this.config.pixelDifferenceThreshold} luma, stride ${this.config.downSampleStride}`],
        ["Camera", `${cameraWidth}x${cameraHeight} @ ${frameRate}fps`],
        ["Last activity", this.formatLastActivity()]
      ];

      details.forEach(([label, value]) => {
        const detailRow = document.createElement("div");
        detailRow.className = "mmm-movement-detection__detail";

        const detailLabel = document.createElement("span");
        detailLabel.className = "mmm-movement-detection__detail-label";
        detailLabel.textContent = label;

        const detailValue = document.createElement("span");
        detailValue.className = "mmm-movement-detection__detail-value";
        detailValue.textContent = value;

        detailRow.appendChild(detailLabel);
        detailRow.appendChild(detailValue);
        detailsPanel.appendChild(detailRow);
      });

      wrapper.appendChild(detailsPanel);
    }

    if (this.cameraError) {
      const errorRow = document.createElement("div");
      errorRow.className = "mmm-movement-detection__error";
      errorRow.textContent = this.cameraError;
      wrapper.appendChild(errorRow);
    }

    if (this.storageError) {
      const errorRow = document.createElement("div");
      errorRow.className = "mmm-movement-detection__error";
      errorRow.textContent = this.storageError;
      wrapper.appendChild(errorRow);
    }

    return wrapper;
  },

  notificationReceived: function (notification) {
    if (notification === "DOM_OBJECTS_CREATED") {
      this.bootstrapMonitoring();
    }
  },

  socketNotificationReceived: function (notification, payload) {
    if (!payload || payload.identifier !== this.identifier) {
      return;
    }

    if (notification === "STATE_LOADED" || notification === "STATE_UPDATED") {
      if (typeof payload.lastMovementAt === "number" && !Number.isNaN(payload.lastMovementAt)) {
        this.lastMovementAt = payload.lastMovementAt;
      }
      this.storageError = null;
      this.updateDom(200);
    }

    if (notification === "PERSISTENCE_ERROR") {
      this.storageError = payload.message || "Could not write the movement log.";
      this.updateDom(200);
    }
  },

  bootstrapMonitoring: function () {
    if (this.monitoringStarted) {
      return;
    }

    this.monitoringStarted = true;
    this.startRenderTimer();
    this.initializeCamera();
  },

  startRenderTimer: function () {
    if (this.renderTimer) {
      return;
    }

    this.renderTimer = window.setInterval(() => {
      this.updateDom(0);
    }, this.config.statusRefreshMs);
  },

  initializeCamera: async function () {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.handleCameraError("Camera access is not available in this MagicMirror runtime.");
      return;
    }

    this.videoElement = document.createElement("video");
    this.videoElement.autoplay = true;
    this.videoElement.muted = true;
    this.videoElement.playsInline = true;
    this.videoElement.setAttribute("playsinline", "true");

    this.canvasElement = document.createElement("canvas");
    this.canvasElement.width = this.config.captureWidth;
    this.canvasElement.height = this.config.captureHeight;
    this.canvasContext = this.canvasElement.getContext("2d", { willReadFrequently: true });

    if (!this.canvasContext) {
      this.handleCameraError("Unable to create the analysis canvas for camera sampling.");
      return;
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: this.config.camera
      });

      this.videoElement.srcObject = this.stream;
      await this.videoElement.play();

      this.cameraReady = true;
      this.cameraError = null;
      this.lastActivityAt = Date.now();
      this.previousFrame = null;
      this.startSampling();
      this.setDimmed(false);
      this.updateDom(200);
    } catch (error) {
      const message = error && error.message ? error.message : "Unknown camera error.";
      this.handleCameraError(`Unable to access the camera: ${message}`);
    }
  },

  startSampling: function () {
    if (this.sampleTimer) {
      window.clearInterval(this.sampleTimer);
    }

    this.sampleTimer = window.setInterval(() => {
      this.sampleFrame();
    }, this.config.checkIntervalMs);
  },

  sampleFrame: function () {
    if (!this.cameraReady || !this.canvasContext || !this.videoElement) {
      return;
    }

    if (this.videoElement.readyState < 2) {
      return;
    }

    this.canvasContext.drawImage(
      this.videoElement,
      0,
      0,
      this.config.captureWidth,
      this.config.captureHeight
    );

    const imageData = this.canvasContext.getImageData(
      0,
      0,
      this.config.captureWidth,
      this.config.captureHeight
    );
    const currentFrame = this.buildLumaFrame(imageData.data);

    if (!this.previousFrame) {
      this.previousFrame = currentFrame;
      this.evaluateIdleState();
      return;
    }

    const stats = this.compareFrames(this.previousFrame, currentFrame);
    this.previousFrame = currentFrame;
    this.currentMotionRatio = stats.changedRatio;
    this.lastMotionStats = stats;

    if (this.config.debug) {
      Log.log(
        `${this.name} motion ratio=${stats.changedRatio.toFixed(4)} changed=${stats.changedCount}/${stats.sampledCount}`
      );
    }

    if (stats.changedRatio >= this.config.changedPixelRatioThreshold) {
      this.onMovementDetected(stats);
    }

    this.evaluateIdleState();
  },

  buildLumaFrame: function (rgbaBuffer) {
    const frame = new Uint8Array(this.config.captureWidth * this.config.captureHeight);
    let targetIndex = 0;

    for (let index = 0; index < rgbaBuffer.length; index += 4) {
      const red = rgbaBuffer[index];
      const green = rgbaBuffer[index + 1];
      const blue = rgbaBuffer[index + 2];
      frame[targetIndex] = Math.round((0.299 * red) + (0.587 * green) + (0.114 * blue));
      targetIndex += 1;
    }

    return frame;
  },

  compareFrames: function (previousFrame, currentFrame) {
    let changedCount = 0;
    let sampledCount = 0;
    const stride = Math.max(1, this.config.downSampleStride);

    for (let index = 0; index < currentFrame.length; index += stride) {
      sampledCount += 1;

      if (Math.abs(currentFrame[index] - previousFrame[index]) >= this.config.pixelDifferenceThreshold) {
        changedCount += 1;
      }
    }

    return {
      changedCount,
      sampledCount,
      changedRatio: sampledCount === 0 ? 0 : changedCount / sampledCount
    };
  },

  onMovementDetected: function (stats) {
    const detectedAt = Date.now();
    const appendEvent = !this.lastLoggedMovementAt
      || (detectedAt - this.lastLoggedMovementAt) >= this.config.movementLogCooldownMs;

    this.lastMovementAt = detectedAt;
    this.lastActivityAt = detectedAt;

    if (appendEvent) {
      this.lastLoggedMovementAt = detectedAt;
    }

    if (this.isDimmed) {
      this.sendNotification("MMM_MOVEMENT_ACTIVE", {
        identifier: this.identifier,
        at: detectedAt
      });
    }

    this.sendNotification("MMM_MOVEMENT_DETECTED", {
      identifier: this.identifier,
      at: detectedAt,
      changedRatio: stats.changedRatio
    });

    this.sendSocketNotification("MOVEMENT_DETECTED", {
      identifier: this.identifier,
      timestamp: detectedAt,
      changedRatio: stats.changedRatio,
      changedCount: stats.changedCount,
      sampledCount: stats.sampledCount,
      appendEvent
    });

    this.setDimmed(false);
    this.updateDom(200);
  },

  evaluateIdleState: function () {
    if (!this.lastActivityAt) {
      return;
    }

    const idleForMs = Date.now() - this.lastActivityAt;
    const shouldDim = idleForMs >= this.config.inactivityTimeoutMs;

    if (shouldDim && !this.isDimmed) {
      this.setDimmed(true);
      this.sendNotification("MMM_MOVEMENT_IDLE", {
        identifier: this.identifier,
        idleForMs,
        lastMovementAt: this.lastMovementAt
      });
      this.updateDom(200);
      return;
    }

    if (!shouldDim && this.isDimmed) {
      this.setDimmed(false);
      this.updateDom(200);
    }
  },

  setDimmed: function (dimmed) {
    const target = document.querySelector(this.config.dimTargetSelector) || document.body;

    if (!target) {
      return;
    }

    if (dimmed) {
      target.style.setProperty("--mmm-movement-detection-screen-brightness", String(this.config.dimBrightness));
      target.classList.add("mmm-movement-detection-dimmed");
    } else {
      target.classList.remove("mmm-movement-detection-dimmed");
      target.style.removeProperty("--mmm-movement-detection-screen-brightness");
    }

    this.isDimmed = dimmed;
  },

  handleCameraError: function (message) {
    this.cameraError = message;
    this.cameraReady = false;
    this.setDimmed(false);
    this.stopSampling();
    this.updateDom(200);
  },

  stopSampling: function () {
    if (this.sampleTimer) {
      window.clearInterval(this.sampleTimer);
      this.sampleTimer = null;
    }
  },

  stop: function () {
    this.stopSampling();

    if (this.renderTimer) {
      window.clearInterval(this.renderTimer);
      this.renderTimer = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }

    this.setDimmed(false);
  },

  getStatusLabel: function () {
    if (this.cameraError) {
      return "Camera error";
    }

    if (!this.monitoringStarted) {
      return "Waiting";
    }

    if (!this.cameraReady) {
      return "Connecting";
    }

    if (this.isDimmed) {
      return "Idle dimmed";
    }

    if (this.lastMovementAt && (Date.now() - this.lastMovementAt) <= (this.config.checkIntervalMs * 2)) {
      return "Movement seen";
    }

    return "Monitoring";
  },

  getStatusClassName: function () {
    if (this.cameraError) {
      return "mmm-movement-detection__chip--error";
    }

    if (this.isDimmed) {
      return "mmm-movement-detection__chip--idle";
    }

    if (this.lastMovementAt && (Date.now() - this.lastMovementAt) <= (this.config.checkIntervalMs * 2)) {
      return "mmm-movement-detection__chip--active";
    }

    return "mmm-movement-detection__chip--ready";
  },

  getCameraStateLabel: function () {
    if (this.cameraError) {
      return "camera unavailable";
    }

    return this.cameraReady ? "camera active" : "camera pending";
  },

  getHeadlineText: function () {
    if (this.cameraError) {
      return "Camera unavailable";
    }

    if (!this.monitoringStarted) {
      return "Waiting for startup";
    }

    if (!this.cameraReady) {
      return "Camera connecting";
    }

    if (this.isDimmed) {
      return "Idle dimmed";
    }

    if (this.lastMovementAt && (Date.now() - this.lastMovementAt) <= (this.config.checkIntervalMs * 2)) {
      return "Movement seen";
    }

    return "Monitoring live";
  },

  getDescriptionText: function () {
    if (this.cameraError) {
      return "Camera access needs attention before motion can be tracked.";
    }

    if (!this.monitoringStarted) {
      return "The module is waiting for MagicMirror to finish creating DOM objects.";
    }

    if (!this.cameraReady) {
      return "The browser is requesting camera access and preparing the motion sampler.";
    }

    if (this.isDimmed) {
      return "No sustained movement was detected, so the configured dimming target is active.";
    }

    return "The camera feed is being sampled for motion and the screen stays awake while activity continues.";
  },

  getIdleStateLabel: function () {
    if (!this.lastActivityAt) {
      return "warming up";
    }

    if (this.isDimmed) {
      return "screen dimmed";
    }

    const remainingMs = Math.max(0, this.config.inactivityTimeoutMs - (Date.now() - this.lastActivityAt));
    return `${this.formatDuration(remainingMs)} left`;
  },

  getSampleSummary: function () {
    if (!this.lastMotionStats) {
      return "0 / 0";
    }

    return `${this.lastMotionStats.changedCount} / ${this.lastMotionStats.sampledCount}`;
  },

  formatLastActivity: function () {
    if (!this.lastActivityAt) {
      return "warming up";
    }

    return new Date(this.lastActivityAt).toLocaleString();
  },

  formatLastMovement: function () {
    if (!this.lastMovementAt) {
      return "No movement recorded yet";
    }

    const relative = this.formatDuration(Date.now() - this.lastMovementAt);
    if (this.config.debug) {
      const absolute = new Date(this.lastMovementAt).toLocaleString();
      return `${absolute} (${relative} ago)`;
    }

    return `${relative} ago`;
  },

  formatDuration: function (durationMs) {
    const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }

    if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    }

    return `${seconds}s`;
  }
});
