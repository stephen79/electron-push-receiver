const { register, listen } = require('push-receiver');
const { ipcMain } = require('electron');
const Config = require('electron-config');
const {
  START_NOTIFICATION_SERVICE,
  NOTIFICATION_SERVICE_STARTED,
  NOTIFICATION_SERVICE_ERROR,
  NOTIFICATION_RECEIVED,
  TOKEN_UPDATED,
} = require('./constants');

const config = new Config();

module.exports = {
  START_NOTIFICATION_SERVICE,
  NOTIFICATION_SERVICE_STARTED,
  NOTIFICATION_SERVICE_ERROR,
  NOTIFICATION_RECEIVED,
  TOKEN_UPDATED,
  setup,
  isRegistered,
  retryRegister
};
const TAG = '[ELECTRON_PUSH_RECEIVER]';
// To be sure that start is called only once
let started = false;
// To be sure that it completes GCM/FCM registration (obtained the token)
let registered = false;
// Cache the senderId from the service started
let _senderId = undefined;
// To be call from the main process
function setup(webContents) {
  // Will be called by the renderer process
  ipcMain.on(START_NOTIFICATION_SERVICE, async (_, senderId) => {
    _senderId = senderId;
    // Retrieve saved credentials
    let credentials = config.get('credentials');
    if (started) {
      webContents.send(NOTIFICATION_SERVICE_STARTED, (credentials.fcm || {}).token);
      console.log(TAG + 'NOTIFICATION_SERVICE_STARTED');
      return;
    }
    started = true;
    // Try to register to GCM/FCM
    _register(webContents, false);
  });
}

// Will be called on new notification
function onNotification(webContents) {
  return ({ notification, persistentId }) => {
    const persistentIds = config.get('persistentIds') || [];
    // Update persistentId
    config.set('persistentIds', [...persistentIds, persistentId]);
    // Notify the renderer process that a new notification has been received
    // And check if window is not destroyed for darwin Apps
    if(!webContents.isDestroyed()){
      webContents.send(NOTIFICATION_RECEIVED, notification);
    }
  };
}
// check if it has registered.
function isRegistered() {
    return registered;
}
// To be call by this module
async function _register(webContents, retry) {
    console.log(TAG + '_register retry:' + retry);
    try {
        // Retrieve saved credentials
        let credentials = config.get('credentials');
        // Retrieve saved senderId
        const savedSenderId = config.get('senderId');
        // Retrieve saved persistentId : avoid receiving all already received notifications on start
        const persistentIds = config.get('persistentIds') || [];
        // Register if no credentials or if senderId has changed
        if (!credentials || savedSenderId !== _senderId) {
            console.log(TAG + 'savedSenderId:' + savedSenderId + ' vs ' + _senderId);
            credentials = await register(_senderId);
            // Save credentials for later use
            config.set('credentials', credentials);
            // Save senderId
            config.set('senderId', _senderId);
            // registered and obtained the token
            registered = true;
            console.log(TAG + 'successfully registered');
            // Notify the renderer process that the FCM token has changed
            webContents.send(TOKEN_UPDATED, credentials.fcm.token);
        }
        // Listen for GCM/FCM notifications
        await listen(Object.assign({}, credentials, { persistentIds }), onNotification(webContents));
        if (!retry) {
            // Notify the renderer process that we are listening for notifications
            webContents.send(NOTIFICATION_SERVICE_STARTED, credentials.fcm.token);
            console.log(TAG + 'NOTIFICATION_SERVICE_STARTED');
        }
    } catch (e) {
        console.error(TAG +'PUSH_RECEIVER:::Error', e);
        // Forward error to the renderer process
        webContents.send(NOTIFICATION_SERVICE_ERROR, e.message);
    }
}
// To be call from the main process
async function retryRegister(webContents) {
    console.log(TAG + 'retryRegister:' + _senderId);
    // Only when the service has started but it hasn't completed the registration
    if (_senderId && started && !registered) {
        _register(webContents, true);
    }
}
