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
                    if (playing.repeat > 1) {
                        playing.times += 1;

                        if (playing.repeat > playing.times) {
                            playing = false;
                            play();
                            return;
                        }
                    }

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

            fs.writeFileSync(mp3, playing.content);

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

    function sync(target) {
        let info;
        let list = [];

        queue.forEach(function (id) {
            let data = files[id];

            list.push({id, title: data.title, volume: data.volume, repeat: data.repeat, times: data.times});
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

        if (target) {
            target.emit(":info", info);
        } else {
            clients.forEach(function (client) {
                client.emit(":info", info);
            });
        }
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

            try {
                data.content = Buffer.from(data.content, "base64");
            } catch (ignore) {
                return;
            }

            data.repeat = parseInt(data.repeat, 10);

            if (data.repeat < 1) {
                data.repeat = 1;
            }

            data.times = 0;

            queue.push(data.id);
            files[data.id] = data;

            if (playing) {
                sync();
            } else {
                play();
            }
        });

        client.on(":stop", function (data) {
            let file = files[data.id];

            if (file) {
                if (playing.id === file.id) {
                    stop(true);
                } else {
                    queue = queue.filter((id) => id !== file.id);
                    delete files[file.id];
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
        sync(client);
    });

    server.listen(8000);

}());
