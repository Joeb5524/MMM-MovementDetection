const fs = require("fs");
const path = require("path");
const NodeHelper = require("node_helper");

module.exports = NodeHelper.create({
  requiresVersion: "2.1.0",

  start: function () {
    this.instanceConfigs = new Map();
  },

  socketNotificationReceived: function (notification, payload) {
    if (!payload || !payload.identifier) {
      return;
    }

    if (notification === "INIT") {
      this.instanceConfigs.set(payload.identifier, payload.config || {});
      this.sendStoredState(payload.identifier);
      return;
    }

    if (notification === "MOVEMENT_DETECTED") {
      this.persistMovement(payload);
    }
  },

  sendStoredState: function (identifier) {
    const statePath = this.resolveFilePath(identifier, "stateFileName", "data/movement-state.json");

    try {
      if (!fs.existsSync(statePath)) {
        this.sendSocketNotification("STATE_LOADED", {
          identifier,
          lastMovementAt: null
        });
        return;
      }

      const rawState = fs.readFileSync(statePath, "utf8");
      const parsedState = JSON.parse(rawState);

      this.sendSocketNotification("STATE_LOADED", {
        identifier,
        lastMovementAt: typeof parsedState.lastMovementAt === "number" ? parsedState.lastMovementAt : null
      });
    } catch (error) {
      this.sendSocketNotification("PERSISTENCE_ERROR", {
        identifier,
        message: `Failed to read ${path.basename(statePath)}: ${error.message}`
      });
    }
  },

  persistMovement: function (payload) {
    const identifier = payload.identifier;
    const timestamp = typeof payload.timestamp === "number" ? payload.timestamp : Date.now();
    const statePath = this.resolveFilePath(identifier, "stateFileName", "data/movement-state.json");
    const logPath = this.resolveFilePath(identifier, "logFileName", "data/movement-events.jsonl");

    try {
      this.ensureDirectory(statePath);
      this.ensureDirectory(logPath);

      const state = {
        lastMovementAt: timestamp,
        lastMovementIso: new Date(timestamp).toISOString(),
        lastMotionRatio: payload.changedRatio
      };

      fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

      if (payload.appendEvent) {
        const event = {
          type: "movement-detected",
          at: timestamp,
          atIso: new Date(timestamp).toISOString(),
          changedRatio: payload.changedRatio,
          changedCount: payload.changedCount,
          sampledCount: payload.sampledCount
        };

        fs.appendFileSync(logPath, `${JSON.stringify(event)}\n`, "utf8");
      }

      this.sendSocketNotification("STATE_UPDATED", {
        identifier,
        lastMovementAt: timestamp
      });
    } catch (error) {
      this.sendSocketNotification("PERSISTENCE_ERROR", {
        identifier,
        message: `Failed to persist movement data: ${error.message}`
      });
    }
  },

  resolveFilePath: function (identifier, configKey, fallbackName) {
    const config = this.instanceConfigs.get(identifier) || {};
    const configuredPath = typeof config[configKey] === "string" && config[configKey].trim().length > 0
      ? config[configKey]
      : fallbackName;

    return path.resolve(this.path, configuredPath);
  },

  ensureDirectory: function (filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }
});
