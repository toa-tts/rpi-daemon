/*jslint long,name,node*/

(function () {

    const exec = require("child_process").exec;
    const express = require("express");
    const fs = require("fs");
    const http = require("http");
    const mp3 = "/home/pi/current.mp3";
    const omx = require("omxplayer-controll");
    const socket = require("socket.io");

    let app = express();
    let clients = [];
    let files = {};
    let handle;
    let pause;
    let playing;
    let queue = [];
    let server = http.createServer(app);
    let volume = 1;
    let io = socket(server, {maxHttpBufferSize: 100 * 1024 * 1024});

    function check() {
        omx.getPosition(function (error) {
            if (playing) {
                if (error) {
                    stop();
                } else {
                    handle = setTimeout(check, 1000);
                }
            }
        });
    }

    function play() {
        if (!playing && queue.length) {
            playing = files[queue[0]];

            fs.writeFileSync(mp3, Buffer.from(playing.content, "base64"));

            if (playing.volume) {
                volume = playing.volume;
            }

            omx.open(mp3, {otherArgs: ["-o", "local"], startVolume: toVolume(volume)});

            handle = setTimeout(check, 1000);
        }

        sync();
    }

    function stop(force) {
        if (playing) {
            pause = false;
            playing = false;
            delete files[queue.shift()];

            if (force) {
                exec("killall omxplayer.bin");
            }

            clearTimeout(handle);
            play();
        }
    }

    function sync() {
        let info;
        let list = [];

        queue.forEach(function (id) {
            let data = files[id];

            list.push({id, title: data.title, volume: data.volume});
        });

        info = {list, volume};

        if (playing) {
            if (pause) {
                info.status = "pause";
            } else {
                info.status = "play";
            }
        } else {
            info.status = "stop";
        }

        clients.forEach(function (client) {
            client.emit(":info", info);
        });
    }

    function toVolume(value) {
        switch (value) {
        case 2:
            return 0.5;
        case 3:
            return 0.18;
        case 4:
            return 0.09;
        case 5:
            return 0.03;
        default:
            return 1;
        }
    }

    io.on("connection", function (client) {
        client.on("disconnect", function () {
            clients = clients.filter((element) => element !== client);
        });

        client.on(":echo", function (data) {
            client.emit(":echo", data);
        });

        client.on(":play", function (data) {
            if (files[data.id]) {
                return;
            }

            queue.push(data.id);
            files[data.id] = data;

            if (playing) {
                sync();
            } else {
                play();
            }
        });

        client.on(":stop", function (data) {
            if (files[data.id]) {
                if (playing.id === data.id) {
                    stop(true);
                } else {
                    queue = queue.filter((id) => id !== data.id);
                    delete files[data.id];
                    sync();
                }
            }
        });

        client.on(":pause", function () {
            if (pause) {
                return;
            }

            pause = true;
            omx.pause();
            sync();
        });

        client.on(":resume", function () {
            if (pause) {
                pause = false;
                omx.playPause();
                sync();
            }
        });

        client.on(":volume", function (data) {
            if (volume !== data.volume) {
                volume = data.volume;
                omx.setVolume(toVolume(volume));
                sync();
            }
        });

        clients.push(client);
    });

    server.listen(8000);

}());
