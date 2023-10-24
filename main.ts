import { app, BrowserWindow, screen, ipcMain, dialog } from 'electron';
import * as path from 'path';
import * as url from 'url';
const Tail = require('tail').Tail;
const Store = require('electron-store');
const { autoUpdater } = require('electron-updater');
const https = require('https');
var _ = require('lodash');

let win: BrowserWindow = null;
const args = process.argv.slice(1),
    serve = args.some(val => val === '--serve');
const WebSocket = require('ws');
let wss;
let clients = [];
let fPath = '';
let fChannel = '';
let options = { separator: /[\r]{0,1}\n/, fromBeginning: false, fsWatchOptions: {}, follow: true, logger: console }
let fTail;
let last = +new Date();
let rateLimitHit = 0;
let currentHits = 0;
let globalItems = [];

function createWindow(): BrowserWindow {
    const store = new Store();
    const electronScreen = screen;
    const size = electronScreen.getPrimaryDisplay().workAreaSize;

    https.get('https://cb-opendkp.s3.us-east-2.amazonaws.com/cache/latest-items.json', (resp) => {
        let data = '';
        // A chunk of data has been received.
        resp.on('data', (chunk) => {
            data += chunk;
        });
        // The whole response has been received. Print out the result.
        resp.on('end', () => {
            globalItems = JSON.parse(data);
        });
    }).on("error", (err) => {
        console.log("Error: " + err.message);
    });    

    // Create the browser window.
    win = new BrowserWindow({
        x: 0,
        y: 0,
        width: size.width,
        height: size.height,
        webPreferences: {
            nodeIntegration: true,
            allowRunningInsecureContent: (serve) ? true : false,
        },
    });

    if (serve) {
        require('electron-reload')(__dirname, {
            electron: require(`${__dirname}/node_modules/electron`)
        });
        win.loadURL('http://localhost:4300');
    } else {
        win.loadURL(url.format({
            pathname: path.join(__dirname, 'dist/index.html'),
            protocol: 'file:',
            slashes: true
        }));
    }

    if (serve) {
        win.webContents.openDevTools();
    }

    // Emitted when the window is closed.
    win.on('closed', () => {
        // Dereference the window object, usually you would store window
        // in an array if your app supports multi windows, this is the time
        // when you should delete the corresponding element.
        win = null;
    });

    //Set some Defaults for the Window from User Preferences
    fPath = store.get('path');
    fChannel = store.get('channel');
    //Should switch to event: ready-to-show???
    win.webContents.on('did-finish-load', () => {
        if (fPath) win.webContents.send('set_path', fPath);
        if (fChannel) win.webContents.send('set_channel', fChannel);
        initWebSocketServer();
    });

    //List for the webContent to open a dialog
    ipcMain.addListener('open_dialog', (event) => {
        dialog.showOpenDialog({
            properties: ['openFile']
        }).then(result => {
            fPath = result.filePaths[0];
            store.set('path', fPath);
            win.webContents.send('path', fPath);
        }).catch(err => {
            console.log(err)
        });
    });

    ipcMain.addListener('start_monitoring', (event, channel) => {
        store.set('channel', channel);
        fChannel = channel;
        startMonitoring();
    });

    return win;
}

function initWebSocketServer() {
    if (!wss) {
        wss = new WebSocket.Server({ port: 8080 });
        wss.on('connection', function connection(ws) {
            win.webContents.send('log_output', 'connection opened from browser');
            ws.on('message', function incoming(message) {
                console.log('received: %s', message);
            });
            clients.push(ws);
        });

        wss.on('listening', () => {
            win.webContents.send('log_output', 'Websocket Server is bound');
        });
    }
}

function startMonitoring() {
    try {
        if ( fTail && fTail.filename==fPath) {
            return;
        }
        
        fTail = new Tail(fPath, options);
        win.webContents.send('log_output', `Tailing log file: ${fPath}`);

        fTail.on("line", function(data) {
            if (data.indexOf(fChannel) > 0) {
                data = data.substring(data.indexOf(', \'') + 3, data.length - 1);
                data = data.trim();
                var items = data.split('|');
                var vSearchItems:any = [];
                if (items.length > 0) {
                    items.forEach(x => {
                        x = x.trim();
                        if (x && x.length > 0) {
                            var index = _.findIndex(globalItems, y=> { 
                                return y.Name.localeCompare(x, undefined, { sensitivity: 'base' })===0;
                            });
                            if ( index >= 0 ) {
                                vSearchItems.push(globalItems[index]);
                            }
                        }
                    });
                    if (vSearchItems.length > 0) {
                        win.webContents.send('new_items', vSearchItems);
                        sendClientMessage(vSearchItems);
                    }
                }
            }
        });
        fTail.on("error", function(error) {
            console.log('ERROR: ', error);
            win.webContents.send('log_output', `Error ${error}`);
        });
    } catch (error) {
        win.webContents.send('log_output', `Erorr trying to tail log file: ${fPath}`);
        win.webContents.send('log_output', error);
    }
}

function sendClientMessage(data) {
    clients.forEach(element => {
        element.send(JSON.stringify(data));
    });
}

autoUpdater.on('checking-for-update', () => {
    win.webContents.send('log_output','Checking for update...');
});

autoUpdater.on('update-available', (info) => {
    win.webContents.send('log_output','Update available.');
});

autoUpdater.on('update-not-available', (info) => {
    win.webContents.send('log_output','Update NOT available.');
});

autoUpdater.on('error', (err) => {
    win.webContents.send('log_output','Error in auto-updater.');
});

autoUpdater.on('download-progress', (progressObj) => {
    let log_message = "Download speed: " + progressObj.bytesPerSecond;
    log_message = log_message + ' - Downloaded ' + progressObj.percent + '%';
    log_message = log_message + ' (' + progressObj.transferred + "/" + progressObj.total + ')';
    win.webContents.send('log_output',log_message);
});

autoUpdater.on('update-downloaded', (info) => {
    win.webContents.send('log_output','Update downloaded');
});

try {

    app.allowRendererProcessReuse = true;

    // This method will be called when Electron has finished
    // initialization and is ready to create browser windows.
    // Some APIs can only be used after this event occurs.
    // Added 400 ms to fix the black background issue while using transparent window. More detais at https://github.com/electron/electron/issues/15947
    app.on('ready', () => {
        // this will check if there is a newer version of the app available and 
        // display the user a notification that the user has to restart the app in order to get the newer version
        setTimeout( () => {autoUpdater.checkForUpdatesAndNotify(); win.webContents.send('log_output','Triggered auto update!')}, 10000);
        setTimeout(createWindow, 400);
    });

    // Quit when all windows are closed.
    app.on('window-all-closed', () => {
        // On OS X it is common for applications and their menu bar
        // to stay active until the user quits explicitly with Cmd + Q
        if (process.platform !== 'darwin') {
            app.quit();
        }
    });

    app.on('activate', () => {
        // On OS X it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        if (win === null) {
            createWindow();
        }
    });
} catch (e) {
    // Catch Error
    // throw e;
}