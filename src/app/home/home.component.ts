import { Component, OnInit, NgZone } from '@angular/core';
import { Router } from '@angular/router';
import { ElectronService } from '../core/services';

@Component({
    selector: 'app-home',
    templateUrl: './home.component.html',
    styleUrls: ['./home.component.scss']
})
export class HomeComponent implements OnInit {
    public logOutput: string = "";
    public path: string = "";
    public channel: string = "";
    public version: string = "Version: ";

    constructor(private router: Router,
        private electronService: ElectronService,
        private zone: NgZone) {}

    ngOnInit(): void {
        this.version += require('electron').remote.app.getVersion();

        this.electronService.ipcRenderer.addListener('new_items', (event, item) => {
            this.zone.run(() => {
                item.forEach(x => {
                    this.logOutput += `Item Detected: ${x}\n`;
                });
            })
        });
        this.electronService.ipcRenderer.addListener('path', (event, path) => {
            this.zone.run(() => {
                this.logOutput += `Log Path set to: ${path}\n`;
                this.path = path;
            })
        });
        this.electronService.ipcRenderer.addListener('set_path', (event, path) => {
            this.zone.run(() => {
                this.logOutput += `Stored Path set to: ${path}\n`;
                this.path = path;
            })
        });
        this.electronService.ipcRenderer.addListener('set_channel', (event, channel) => {
            this.zone.run(() => {
                this.logOutput += `Stored Channel set to: ${channel}\n`;
                this.channel = channel;
            })
        });
        this.electronService.ipcRenderer.addListener('log_output', (event, message) => {
            this.zone.run(() => {
                this.logOutput += `${message}\n`;
            })
        });
    }

    openFile() {
        this.electronService.ipcRenderer.send('open_dialog');
    }

    startMonitor() {
      this.channel = this.channel.trim();
      if (this.channel.length <= 0) {
          alert('you must first set a chat channel to be monitored');
          return;
      }
      this.electronService.ipcRenderer.send('start_monitoring', this.channel);
    }
}