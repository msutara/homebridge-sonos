var sonos = require('sonos');
var _ = require('underscore');
var inherits = require('util').inherits;
var Service, Characteristic, VolumeCharacteristic;
var sonosAccessories = [];

module.exports = function (homebridge) {
        Service = homebridge.hap.Service;
        Characteristic = homebridge.hap.Characteristic;

        // we can only do this after we receive the homebridge API object
        makeVolumeCharacteristic();

        homebridge.registerAccessory("homebridge-sonos", "Sonos", SonosAccessory);
}

//
// Sonos Accessory
//
function SonosAccessory(log, config) {

        this.log = log;
        this.config = config;
        this.name = config["name"];
        this.room = config["room"];
        this.mute = config["mute"];
        this.model = config["model"];
        this.serial = config["serial_number"];

        if (!this.name) throw new Error("You must provide a config value for 'name'.");
        if (!this.room) throw new Error("You must provide a config value for 'room'.");

        this.accessoryInformationService = new Service.AccessoryInformation();

        this.accessoryInformationService
                .setCharacteristic(Characteristic.Manufacturer, "Sonos")
                .setCharacteristic(Characteristic.Model, this.model || "Not Available")
                .setCharacteristic(Characteristic.Name, this.name)
                .setCharacteristic(Characteristic.SerialNumber, this.serial || "Not Available")
                .setCharacteristic(Characteristic.FirmwareRevision, require('./package.json').version);

        this.longPoll = parseInt(this.config.longPoll, 10) || 60;
        this.tout = null;
        this.updating = false;

        if (!this.mute) {
                this.service = new Service.Lightbulb(this.name);
                this.service
                        .getCharacteristic(Characteristic.On)
                        .on('get', this.getOn.bind(this))
                        .on('set', this.setOn.bind(this));
                this.service
                        .addCharacteristic(Characteristic.Brightness)
                        .on('get', this.getVolume.bind(this))
                        .on('set', this.setVolume.bind(this));
        }
        else {
                this.speakerService = new Service.Speaker(this.name);
                this.speakerService
                        .getCharacteristic(Characteristic.Mute)
                        .on('get', this.getMute.bind(this))
                        .on('set', this.setMute.bind(this));
                this.speakerService
                        .addCharacteristic(Characteristic.Volume)
                        .on('get', this.getVolume.bind(this))
                        .on('set', this.setVolume.bind(this));
        }

        this.periodicUpdate();
}

SonosAccessory.zoneTypeIsPlayable = function (zoneType) {
        // 8 is the Sonos SUB, 4 is the Sonos Bridge, 11 is unknown
        return zoneType != '11' && zoneType != '8' && zoneType != '4';
}

SonosAccessory.prototype.search = function () {
        const search = sonos.Search({ timeout: 5000 });
        search.on('DeviceAvailable', (device, model) => {

                this.log("Found sonos device %s at %s:%s", model, device.host, device.port);

                device.deviceDescription()
                        .then(deviceDescription => {
                                var zoneType = deviceDescription["zoneType"];
                                var roomName = deviceDescription["roomName"];

                                if (SonosAccessory.zoneTypeIsPlayable(zoneType)) {
                                        if (roomName == this.room) {
                                                this.log.debug("Found a playable device at %s for room '%s'", device.host, roomName);

                                                var known = false;
                                                for(var accessory of sonosAccessories) {
                                                        if (accessory.device) {
                                                                if (accessory.device.host == device.host) {
                                                                        this.log.debug("Playable device at %s is already known", device.host);
                                                                        known = true;
                                                                        break;
                                                                }
                                                        }
                                                }
                                                if (!known) {
                                                        this.log.debug("Adding playable device at %s", device.host);
                                                        this.device = device;
                                                        sonosAccessories.push(this);
                                                }
                                        }
                                        else {
                                                this.log.debug("Ignoring device %s because the room name '%s' does not match the desired name '%s'.", device.host, roomName, this.room);
                                        }
                                }
                                else {
                                        this.log.debug("Sonos device %s is not playable (has an unknown zone type of %s); ignoring", device.host, zoneType);
                                }
                        })
                        .catch(err => {
                                this.log('Error adding %j', err);
                        });
        });

        setTimeout(function () {
                this.log.debug('Stop searching for Sonos devices')
        }.bind(this), 5000);
}

SonosAccessory.prototype.getServices = function () {
        if (!this.mute) {
                return [this.accessoryInformationService, this.service];
        }
        else {
                return [this.accessoryInformationService, this.speakerService];
        }
}

SonosAccessory.prototype.getOn = function (callback) {
        if (!this.device) {
                this.log.warn("Ignoring request; Sonos device has not yet been discovered. Confirm 'room' parameter matches Sonos App");
                callback(new Error("Sonos has not been discovered yet."));
                return;
        }

        if (!this.mute) {
                this.device.getCurrentState()
                        .then(state => {
                                var on = (state == "playing");
                                callback(null, on);
                        })
                        .catch(err => {
                                this.log('Error getting current state %j', err);
                                callback(err);
                        });
        }
        else {
                this.device.getMuted()
                        .then(state => {

                                this.log.warn("Current state for Sonos: " + state);
                                var on = (state == false);
                                callback(null, on);
                        })
                        .catch(err => {
                                this.log('Error getting muted state %j', err);
                                callback(err);
                        });
        }
}

SonosAccessory.prototype.setOn = function (on, callback) {
        if (!this.device) {
                this.log.warn("Ignoring request; Sonos device has not yet been discovered. Confirm 'room' parameter matches Sonos App");
                callback(new Error("Sonos has not been discovered yet."));
                return;
        }

        this.log("Setting power to " + on);
        if (!this.mute) {
                if (on) {
                        this.device.play()
                                .then(success => {
                                        this.log("Playback attempt with success: " + success);
                                        callback(null);
                                })
                                .catch(err => {
                                        this.log('Error playing %j', err);
                                        callback(err);
                                });
                }
                else {
                        this.device.pause()
                                .then(success => {
                                        this.log("Pause attempt with success: " + success);
                                        callback(null);
                                })
                                .catch(err => {
                                        this.log('Error pausing %j', err);
                                        callback(err);
                                });;
                }
        }
        else {
                if (on) {
                        this.device.setMuted(false)
                                .then(success => {
                                        this.log("Unmute attempt with success: " + success);
                                        callback(null);
                                })
                                .catch(err => {
                                        this.log('Error setting muted false %j', err);
                                        callback(err);
                                });;
                }
                else {
                        this.device.setMuted(true)
                                .then(success => {
                                        this.log("Mute attempt with success: " + success);
                                        callback(null);
                                })
                                .catch(err => {
                                        this.log('Error setting muted true %j', err);
                                        callback(err);
                                });;
                }
        }
}

SonosAccessory.prototype.getVolume = function (callback) {
        if (!this.device) {
                this.log.warn("Ignoring request; Sonos device has not yet been discovered. Confirm 'room' parameter matches Sonos App");
                callback(new Error("Sonos has not been discovered yet."));
                return;
        }

        this.device.getVolume()
                .then(volume => {
                        this.log("Current volume: %s", volume);
                        callback(null, Number(volume));
                })
                .catch(err => {
                        this.log('Error getting volume %j', err);
                        callback(err);
                });;
}

SonosAccessory.prototype.setVolume = function (volume, callback) {
        if (!this.device) {
                this.log.warn("Ignoring request; Sonos device has not yet been discovered. Confirm 'room' parameter matches Sonos App");
                callback(new Error("Sonos has not been discovered yet."));
                return;
        }

        this.log("Setting volume to %s", volume);

        this.device.setVolume(volume)
                .then(data => {
                        this.log("Set volume response with data: " + JSON.stringify(data));
                        callback(null);
                })
                .catch(err => {
                        this.log('Error setting volume %j', err);
                        callback(err);
                });;
}

SonosAccessory.prototype.getMute = function (callback) {
        if (!this.device) {
                this.log.warn("Ignoring request; Sonos device has not yet been discovered.");
                callback(new Error("Sonos has not been discovered yet."));
                return;
        }

        this.device.getMuted()
                .then(state => {
                        this.log.warn("Current mute state for Sonos: " + state);
                        callback(null, state);
                })
                .catch(err => {
                        this.log('Error getting muted state %j', err);
                        callback(err);
                });;
}

SonosAccessory.prototype.setMute = function (mute, callback) {
        if (!this.device) {
                this.log.warn("Ignoring request; Sonos device has not yet been discovered.");
                callback(new Error("Sonos has not been discovered yet."));
                return;
        }

        this.log("Setting mute to " + mute);
        this.device.setMuted(mute)
                .then(success => {
                        this.log("Unmute attempt with success: " + success);
                        callback(null);
                })
                .catch(err => {
                        this.log('Error setting muted state %j', err);
                        callback(err);
                });;
}

//
// Custom Characteristic for Volume
//
function makeVolumeCharacteristic() {

        VolumeCharacteristic = function () {
                Characteristic.call(this, 'Volume', '91288267-5678-49B2-8D22-F57BE995AA93');
                this.setProps({
                        format: Characteristic.Formats.INT,
                        unit: Characteristic.Units.PERCENTAGE,
                        maxValue: 100,
                        minValue: 0,
                        minStep: 1,
                        perms: [Characteristic.Perms.READ, Characteristic.Perms.WRITE, Characteristic.Perms.NOTIFY]
                });
                this.value = this.getDefaultValue();
        };

        inherits(VolumeCharacteristic, Characteristic);
}


// Method for state periodic update
SonosAccessory.prototype.periodicUpdate = function () {
        this.log("periodicUpdate called");
        this.search();

        // Setup periodic update with polling interval
        this.tout = setTimeout(function () {
                this.log.debug("periodicUpdate timeout reached");
                this.tout = null
                this.updateState(function (err) {
                        if (err) {
                                this.log.warn("Ignoring periodicUpdate, hit an error");
                        }
                        // Setup next polling
                        this.updating = false;
                        this.periodicUpdate();

                }.bind(this));
        }.bind(this), this.longPoll * 1000);
}

SonosAccessory.prototype.updateState = function (callback) {
        if (this.updating) {
                this.log("updateState called while previous still active");
                callback(null);
                return;
        }

        this.log.debug("updateState called");
        this.updating = true;

        // Update states for all HomeKit accessories
        sonosAccessories.forEach(function (accessory) {
                if (accessory.device) {
                        accessory.device.getVolume()
                                .then(volume => {
                                        this.log("getVolume: " + volume);
                                        var vol = Number(volume);
                                        if (!this.mute) {
                                                accessory.service
                                                        .setCharacteristic(Characteristic.Brightness, vol);
                                        }
                                        else {
                                                accessory.speakerService
                                                        .setCharacteristic(Characteristic.Volume, vol);
                                        }
                                })
                                .catch(err => {
                                        if (err) {
                                                this.log.warn("Ignoring, hit an error to get volume");
                                                callback(err);
                                                return;
                                        }
                                });;

                        if (!this.mute) {
                                accessory.device.getCurrentState()
                                        .then(state => {
                                                this.log("getCurrentState: " + state);
                                                var currState = (state == "playing");
                                                accessory.service
                                                        .setCharacteristic(Characteristic.On, currState);

                                        })
                                        .catch(err => {
                                                if (err) {
                                                        this.log.warn("Ignoring, hit an error to get state");
                                                        callback(err);
                                                        return;
                                                }
                                        });;
                        }
                        else {
                                accessory.device.getMuted()
                                        .then(state => {
                                                this.log("getMuted: " + state);
                                                var currState = (state == "playing");
                                                accessory.speakerService
                                                        .setCharacteristic(Characteristic.Mute, currState);
                                        })
                                        .catch(err => {
                                                if (err) {
                                                        this.log.warn("Ignoring, hit an error to get muted state");
                                                        callback(err);
                                                        return;
                                                }
                                        });;
                        }

                }

        }.bind(this));
        callback(null);
}
