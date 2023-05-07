const express = require('express')
const path = require('path')
const fs = require('fs')
const { v4: uuidv4 } = require('uuid');
const BadWordFilter = require('bad-words')
const fileUpload = require('express-fileupload');
const jsdom = require("jsdom")
const request = require('sync-request')
const utils = require('./utils');
const md5f = require('md5-file');
const nodemailer = require('nodemailer')
const jwt = require("jsonwebtoken")

const extraBadWords = ["niqqa", "lilnigga", "negas", "nega", "niqqas", "kurwo", "debil", "gówniarz", "pizda"]
const bannedIps = []

const tokenSecret = process.env.JWT_TOKENSECRET;

const port = 8910

const app = express()
const http = require('http').Server(app);

const { Server } = require("socket.io");

const { instrument } = require("@socket.io/admin-ui");
const io = new Server(http, {
    cors: {
      origin: ["https://admin.socket.io"],
      credentials: true
    },
    pingInterval: 10000,
    pingTimeout: 5000
});

const { MongoClient, ObjectId } = require('mongodb');

const connectionString =
  process.env.MONGO_CONSTR;
const client = new MongoClient(connectionString);

client.connect()

const database = client.db('pocochat')

const chatCollection = database.collection('chat')
const usersCollection = database.collection('users')
const bannedCollection = database.collection('banned')

instrument(io, {
    auth: {
        type: "basic",
        username: process.env.SOCKET_ADMIN_USER,
        password: process.env.SOCKET_ADMIN_PASSHASH
    }
});

let peopleTyping = [];

let pongList = [];

io.use(async (socket, next) => {
    const bannedUser = await bannedCollection.findOne({ip: socket.handshake.headers["x-forwarded-for"]});
    if (bannedUser === null || bannedUser === undefined) {
        await bannedCollection.insertOne({
            ip: socket.handshake.headers["x-forwarded-for"],
            banned: false,
            ends: 0,
            reason: "",
            moderator: ""
        })
        return next();
    }
    else {
        if (bannedUser.banned) {
            if (Date.now() <= bannedUser.ends) {
                return next(new Error("Access Denied"))
            }
            else {
                await bannedCollection.updateOne({ip: socket.handshake.headers["x-forwarded-for"]}, {
                    $set: {
                        banned: false
                    }
                });
                return next();
            }
        }
        return next();
    }
})

app.use(async (req, res, next) => {
    const rIp = req.headers["x-forwarded-for"] != null ? req.headers["x-forwarded-for"] : req.ip;
    const bannedUser = await bannedCollection.findOne({ip: rIp});
    if (bannedUser === null || bannedUser === undefined) {
        await bannedCollection.insertOne({
            ip: rIp,
            banned: false,
            ends: 0,
            reason: "",
            moderator: ""
        })
        return next();
    }
    else {
        if (bannedUser.banned) {
            if (Date.now() <= bannedUser.ends) {;
                return res.send(fs.readFileSync(path.join(__dirname, "ban.html")).toString()
                        .replaceAll("%MODERATOR%", bannedUser.moderator)
                        .replaceAll("%REASON%", bannedUser.reason)
                        .replaceAll("%ENDS%", bannedUser.ends)
                );
            }
            else {
                await bannedCollection.updateOne({ip: rIp}, {
                    $set: {
                        banned: false
                    }
                });
                return next();
            }
        }
        return next();
    }
})

io.on('connection', async socket => {
    
    console.log(
      "socks hehehehehe",
      socket.id
    );
    socket.emit('initial-data', {
        peopleTyping: peopleTyping
    })

    socket.on('pong', () => {
        pongList.push(socket.id)
    })

    socket.on('mod-ban', async (data) => {

        const requestor = await usersCollection.findOne({
            socketId: socket.id
        })

        if (requestor != undefined && requestor.roles != undefined && requestor.roles.includes("moderation") && data.id != undefined && data.banTime != undefined && typeof data.id === "string" && data.toggle != undefined && typeof data.toggle === "boolean" && typeof data.banTime === "number") {
            try {
                const user = people.find(p => p.username === data.id);

                const targetIp = user != undefined ? user.ipdata.ip : (await usersCollection.findOne({username: data.id})).ipdata.ip;

                if (data.toggle) {
                    await bannedCollection.updateOne({
                        ip: targetIp
                    }, {
                        $set: {
                            banned: true,
                            reason: data.reason,
                            ends: Date.now() + (data.banTime * 60000),
                            moderator: requestor.username
                        }
                    })
                    io.sockets.sockets.get(user.socketId).disconnect();
                }
                else 
                {
                    await bannedCollection.updateOne({
                        ip: targetIp
                    }, {
                        $set: {
                            banned: false
                        }
                    })
                }
            } catch (e) {
                console.log(e);
            }
        }
        else {
            console.log("bro tried💀", data)
        }
    })

    socket.on("mod-send-notice", async (data) => {
        const requestor = await usersCollection.findOne({
            socketId: socket.id
        })

        if (requestor != undefined && requestor.roles != undefined && requestor.roles.includes("moderation") && data.id != undefined && typeof data.id === "string" && data.msg != undefined && typeof data.msg === "string") {
            try {
                const reciever = people.find(p => p.username === data.id);
                io.to(reciever.socketId).emit('notice', data.msg);
            } catch (e) {
                console.log(e);
            }
        }
        else {
            console.log("bro tried💀", data)
        }
    })

    socket.on('mod-delete-msg', async (data) => {
        const requestor = await usersCollection.findOne({
            socketId: socket.id
        })

        if (requestor != undefined && requestor.roles != undefined && requestor.roles.includes("moderation") && data.id != undefined && typeof data.id === "string") {
            try {
                let msgSender = data.id.split("@")[0];
    
                let msgDate = parseInt(data.id.split("@")[1].split(":")[0]);
    
                let msgMongoID = data.id.split("@")[1].split(":")[1];

                await chatCollection.deleteOne({
                    time: msgDate,
                    username: msgSender,
                    _id: new ObjectId(msgMongoID)
                });

                io.emit('chat-update');
            } catch (e) {
                console.log(e);
            }
        }
        else {
            console.log("bro tried💀", data)
        }
    })

    socket.on('user-typing', (data) => {
        if (data === undefined) return;
        if (data.uuid === undefined || data.typing === undefined)
            return;

        if (data.uuid === null || data.typing === null)
            return;

        if (typeof data.typing != 'boolean' || typeof data.uuid != 'string')
            return;

        const possiblePerson = people.find(p => p.uuid === data.uuid)
        if (possiblePerson != undefined) {
            if (possiblePerson.socketId === socket.id) {
                data.username = possiblePerson.username;
                socket.broadcast.emit('user-typing', data)
                console.log(data);
                if (data.typing) {
                    peopleTyping.push(data.username);
                }
                else {
                    peopleTyping = peopleTyping.filter(e => e !== data.username);
                }
            }
        }
    });

    socket.on('disconnect', function () {
        console.log('NO MORE SOCKS FOR ' + socket.id);
        
        const possiblePerson = people.find(p => p.socketId === socket.id);
        if (possiblePerson != undefined) {
            // Chat("<div><small>[SYSTEM] <xmp>" + possiblePerson.username + "</xmp> left Chatroom</small></div>");
            Chat({
                type: "system-message",
                html: possiblePerson.username + " left Chatroom"
            });
            io.emit('user-typing', {
                typing: false,
                username: possiblePerson.username
            })

            usersCollection.updateOne({
                username: possiblePerson.username
            }, {
                $set: {
                    currentState: "offline",
                    lastLeftDate: Date.now()
                }
            })

            peopleTyping = peopleTyping.filter(e => e !== possiblePerson.username);

            people = people.filter(p => p.socketId !== possiblePerson.socketId);
            io.emit('chat-update');
        }
    });

    socket.on('message-sent', async function(msg) {
        let data = msg;

        console.log(data)

        if (data === undefined) return;
        if (data.uuid === undefined || data.date === undefined || data.html === undefined) return;

        if (data.uuid === null || data.date === null || data.html === null) return;

        if (typeof data.uuid != 'string' || typeof data.date != 'number' || typeof data.html != 'string') return;

        const person = people.find(p => p.uuid === data.uuid);

        console.log(person);
        if (person != undefined && person.socketId === socket.id) {
            switch (data.html) {
                case "!clear":
                    await chatCollection.deleteMany({ });
                    Chat({
                        type: 'system-message',
                        html: person.username + " cleared chat."
                    })
                    break;
                case "!hehehehehe":
                    Chat({
                        type: "image",
                        src: "hehehehehe.gif",
                        caption: "",
                        time: Date.now(),
                        userid: data.uuid,
                        username: person.username,
                        badges: person.badges === undefined ? "" : person.badges
                    });
                    break;
                default:
                    let formattedMsg = "";
                    if (false) { // DISABLED
                        const emoji = data.html.slice(4).trim();
                        data.html =
                          "<img style='width:32px;height:32px' src='" +
                          emoji
                            .replaceAll("<", "&lt;")
                            .replaceAll(">", "&gt;")
                            .replaceAll('"', "&quot;") +
                          "'>";
                    }
                    else {
                        formattedMsg = data.html.replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); // bruh moment typo i did before: replaceAl
                        if (/<\/?[a-z][\s\S]*>/i.test(formattedMsg) || formattedMsg.toLowerCase().includes("<svg")) {
                            io.to(socket.id).emit('message-fail', "ERROR_CODE_INJETION_BLOCKED");
                            break;
                        }
                        if (formattedMsg.length >= 2000) {
                            io.to(socket.id).emit('message-fail', "ERROR_ILLEGAL_MESSAGE_LENGTH");
                            break;
                        }
                        fs.readdirSync(path.join(__dirname, "emojis")).forEach((emoji) => {
                            if (emoji.split(".")[0] != "") {
                                formattedMsg = formattedMsg.replaceAll(":" + emoji.split(".")[0] + ":", `<img src='emojis/${emoji}' class='emoji'>`);
                            }
                        });
                        if (formattedMsg.trim().includes("<div") || formattedMsg.trim().includes("</div>")) {
                            formattedMsg = formattedMsg.trim().replaceAll("<div", "<span").replaceAll("</div>", "</span>");
                        }
                        formattedMsg = formattedMsg.trim();

                        let fmBuffer = "";
                        formattedMsg.split("\n").forEach((fmLine, fmLi) => {
                            if (fmLine.startsWith("#")) {
                                const hashes = fmLine.split(" ")[0]
                                if (utils.allSame(hashes) && hashes.length <= 6) {
                                    fmLine = "<h" + hashes.length + ">" + fmLine.slice(hashes.length + 1) + "</h" + hashes.length + ">"
                                }
                            }

                            fmBuffer += (fmLi === 0 ? "": "\n") + fmLine;
                        });
                        formattedMsg = fmBuffer;
                        formattedMsg = utils.whatsappStyles(formattedMsg, "_", "<i>", "</i>");
                        formattedMsg = utils.whatsappStyles(formattedMsg, "*", "<b>", "</b>");
                        formattedMsg = utils.whatsappStyles(formattedMsg, "~", "<s>", "</s>");
                        formattedMsg = utils.whatsappStyles(formattedMsg, "&", "<div class='shake d-inline-block'>", "</div>");
                        formattedMsg = utils.whatsappStyles(formattedMsg, "§", "<div class='shake red d-inline-block'>", "</div>");
                        formattedMsg = utils.whatsappStyles(formattedMsg, "|", "<div class='spoiler d-inline-block'>", "</div>");
                        const filter = new BadWordFilter({
                            placeHolder: "█"
                        });
                        filter.addWords(...extraBadWords);
                        filter.removeWords("hell", "god");
                        try {
                        formattedMsg = filter.clean(formattedMsg); // bad words aren't good
                        } catch {}
                        formattedMsg = wrapURL(formattedMsg);
                    }
                    if (typeof formattedMsg === "object") {
                        formattedMsg.time = Date.now();
                        formattedMsg.userid = data.uuid;
                        formattedMsg.username = person.username;
                        formattedMsg.badges = person.badges;
                        Chat(formattedMsg);
                    }
                    else {
                        Chat({
                            type: "text",
                            html: formattedMsg.replaceAll("\n", "<br>"),
                            time: Date.now(),
                            userid: data.uuid,
                            username: person.username,
                            badges: person.badges === undefined ? "" : person.badges
                        });
                    }
                    // Chat("<div class='message-container'><div class='message'><small>[<xmp>" + person.username + "</xmp>] " + (person.badges === undefined ? "" : person.badges) + " @ " + formattedTime + "</small><br>" + formattedMsg + "</div></div>");
                    break;
            }
        }
        io.emit('chat-update');
    })
})

app.use(express.text(), fileUpload(), express.urlencoded({extended: true}))

let people = []

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, "www/index.html"))
})

app.get('/hehehehehe.gif', (req, res) => {
    res.sendFile(path.join(__dirname, "hehehehehe.gif"))
})

app.get('/logo.svg', (req, res) => {
    res.sendFile(path.join(__dirname, "logo.svg"))
})

app.get('/logo-sm.svg', (req, res) => {
    res.sendFile(path.join(__dirname, "logo-sm.svg"))
})

app.post('/chat', async (req, res) => {
    if (req.body) {
        const data = JSON.parse(req.body);
        const person = people.find(p => p.uuid === data.uuid);
        if (person != undefined) {
            person.lastChatPing = Date.now();
        }
    }
    // res.sendFile(path.join(__dirname, "chat.json"))

    const chat = await chatCollection.find().toArray();

    res.send(chat)
})

app.get('/sumung.mp3', (req, res) => {
    res.sendFile(path.join(__dirname, "www/sumung.mp3"))
})

app.get('/send.mp3', (req, res) => {
    res.sendFile(path.join(__dirname, "www/send.mp3"))
})

app.get('/emojis/*', (req, res) => {
    res.sendFile(path.join(__dirname, "emojis/" + req.params["0"]));
})

app.get('/icons/*', (req, res) => {
    res.sendFile(path.join(__dirname, "icons/" + req.params["0"]));
})

app.get('/favicon.ico', (req, res) => {
    res.sendFile(path.join(__dirname, "favicon.ico"));
});

app.get('/manifest.json', (req, res) => {
    res.sendFile(path.join(__dirname, "manifest.json"));
})

app.get('/styles/*', (req, res) => {
    res.sendFile(path.join(__dirname, "www/styles/" + req.params["0"]));
})

app.get('/resetpassword', (req, res) => {
    res.sendFile(path.join(__dirname, "www/resetpassword/"));
})

app.post('/resetpassword', async (req,res) => {
    try {
        const user = await usersCollection.findOne({username: req.body.username});

        if (user != undefined) {

            const prt = (uuidv4() + Date.now())
            .split("")
            .sort(function () {
                return 0.5 - Math.random();
            })
            .join("");

            usersCollection.updateOne({username: user.username}, 
            {
                $set: 
                {
                    prt: prt
                }
            });

            var mailOptions = {
              from: process.env.MAILER_ADDR,
              to: user.email,
              subject: "Password reset for POCOChat account",
              text:
                "Open this URL to change password: https://chat.poco.ga/resetpassword?e=" +
                prt,
              html:
                '<div style="margin: 20px;">' + `<svg xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" xmlns="http://www.w3.org/2000/svg" xmlns:svg="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-chat-square-text" viewBox="0 0 16 16" version="1.1" id="svg6" sodipodi:docname="logo.svg" inkscape:version="1.2 (dc2aeda, 2022-05-15)">
                <defs id="defs10"/>
                <sodipodi:namedview id="namedview8" pagecolor="#505050" bordercolor="#eeeeee" borderopacity="1" inkscape:showpageshadow="0" inkscape:pageopacity="0" inkscape:pagecheckerboard="0" inkscape:deskcolor="#505050" showgrid="false" inkscape:zoom="20.1" inkscape:cx="6.0199005" inkscape:cy="6.2686567" inkscape:window-width="1387" inkscape:window-height="942" inkscape:window-x="0" inkscape:window-y="25" inkscape:window-maximized="0" inkscape:current-layer="svg6"/>
                <path d="m 14.378754,3.632995 a 0.91167942,0.97565487 0 0 1 0.689534,1.1658807 l -1.599591,7.6152063 a 0.91167942,0.97565487 0 0 1 -1.089432,0.73792 l -2.223707,-0.53495 a 1.8233588,1.9513097 0 0 0 -1.5831315,0.419153 l -2.196488,2.004603 -1.183547,-2.817726 A 1.8233588,1.9513097 0 0 0 3.929178,11.119193 L 1.7054708,10.584243 A 0.91167942,0.97565487 0 0 1 1.0159368,9.4183626 L 2.6155278,1.8031567 A 0.91167942,0.97565487 0 0 1 3.7049596,1.0652358 Z M 3.9049085,0.11333513 A 1.8233588,1.9513097 0 0 0 1.7260449,1.5891767 L 0.12645386,9.2043826 A 1.8233588,1.9513097 0 0 0 1.5055219,11.536144 l 2.2237072,0.534949 a 0.91167942,0.97565487 0 0 1 0.6316068,0.551945 l 1.183547,2.817726 a 0.91167942,0.97565487 0 0 0 1.4231726,0.342368 l 2.1964881,-2.004603 a 0.91167942,0.97565487 0 0 1 0.7915657,-0.209576 l 2.2237077,0.53495 A 1.8233588,1.9513097 0 0 0 14.35818,12.628061 L 15.957771,5.0128556 A 1.8233588,1.9513097 0 0 0 14.578703,2.6810943 Z" id="path2" style="fill:#000000;stroke-width:0.943125;stroke:none"/>
                <g aria-label="p" id="text395" style="font-size:12px;font-family:'Apple Color Emoji';-inkscape-font-specification:'Apple Color Emoji';text-align:center;text-anchor:middle;fill:#000000;stroke:none"/>
                <rect style="fill:#000000;fill-opacity:1;stroke:none;stroke-width:2.9182;stroke-opacity:1" id="rect2012" width="1.1116071" height="7.8039351" x="5.872087" y="7.5975428" ry="0.10005045"/>
                <path style="color:#000000;fill:#000000;-inkscape-stroke:none;stroke:none" d="m 9.5136719,4.0410156 c -2.0011283,0 -3.6367188,1.6355905 -3.6367188,3.6367188 0,2.0011282 1.6355905,3.6347656 3.6367188,3.6347656 2.0011281,0 3.6347661,-1.6336374 3.6347661,-3.6347656 0,-2.0011283 -1.633638,-3.6367188 -3.6347661,-3.6367188 z m 0,1.1230469 c 1.3942421,0 2.5117191,1.1194302 2.5117191,2.5136719 0,1.3942416 -1.117477,2.5117186 -2.5117191,2.5117186 C 8.1194302,10.189453 7,9.071976 7,7.6777344 7,6.2834927 8.1194302,5.1640625 9.5136719,5.1640625 Z" id="path2016"/>
                <path d="m 14.396342,3.6018006 a 0.91167942,0.97565487 0 0 1 0.689534,1.1658807 l -1.599591,7.6152057 a 0.91167942,0.97565487 0 0 1 -1.089432,0.73792 l -2.223707,-0.53495 A 1.8233588,1.9513097 0 0 0 8.5900155,13.00501 L 6.3935277,15.009613 5.2099807,12.191887 A 1.8233588,1.9513097 0 0 0 3.9467671,11.087998 L 1.7230599,10.553049 A 0.91167942,0.97565487 0 0 1 1.0335259,9.3871682 L 2.6331169,1.7719623 A 0.91167942,0.97565487 0 0 1 3.7225487,1.0340414 Z M 3.9224976,0.08214074 A 1.8233588,1.9513097 0 0 0 1.743634,1.5579823 L 0.14404296,9.1731882 A 1.8233588,1.9513097 0 0 0 1.523111,11.504949 l 2.2237072,0.534949 a 0.91167942,0.97565487 0 0 1 0.6316068,0.551945 l 1.1835467,2.817726 a 0.91167942,0.97565487 0 0 0 1.423173,0.342368 l 2.1964878,-2.004603 a 0.91167942,0.97565487 0 0 1 0.791566,-0.209576 l 2.2237065,0.53495 a 1.8233588,1.9513097 0 0 0 2.178863,-1.475842 L 15.975359,4.9816612 A 1.8233588,1.9513097 0 0 0 14.596291,2.6498999 Z" id="path2-9" style="fill:#000000;stroke:none;stroke-width:0.943125"/>
                <g aria-label="p" id="text395-3" style="font-size:12px;font-family:'Apple Color Emoji';-inkscape-font-specification:'Apple Color Emoji';text-align:center;text-anchor:middle;fill:#000000;stroke:none" transform="translate(0.01758906,-0.03119439)"/>
                <rect style="fill:#000000;fill-opacity:1;stroke:none;stroke-width:2.9182;stroke-opacity:1" id="rect2012-8" width="1.1116071" height="7.8039351" x="5.8896766" y="7.5663486" ry="0.10005045"/>
                <path style="color:#000000;fill:#000000;stroke:none" d="m 9.5312605,4.0098212 c -2.0011278,0 -3.6367178,1.6355905 -3.6367178,3.6367188 0,2.0011282 1.63559,3.634765 3.6367178,3.634765 2.0011275,0 3.6347655,-1.6336368 3.6347655,-3.634765 0,-2.0011283 -1.633638,-3.6367188 -3.6347655,-3.6367188 z m 0,1.1230469 c 1.3942415,0 2.5117185,1.1194302 2.5117185,2.5136719 0,1.3942416 -1.117477,2.511719 -2.5117185,2.511719 -1.3942408,0 -2.5136718,-1.1174774 -2.5136718,-2.511719 0,-1.3942417 1.119431,-2.5136719 2.5136718,-2.5136719 z" id="path2016-0"/>
              </svg>` + '<h1>Hey!</h1><p>Are you trying to reset your password for "' + user.username + '"?<br><br><br><br><a style="background-color: #ac00ff;padding:10px;color:white;font-size:15pt;border-radius:3px;text-decoration:none;" target="_blank" href="https://chat.poco.ga/newpassword?e=' +
                prt +
                '">Yes, change password</a><br><br> or copy this into your browser: https://chat.poco.ga/newpassword?e=' +
                prt +
                "</p><p>More details about requestor:<ul><li>IP: " + req.headers["x-forwarded-for"] + "</li><li>User-Agent: " + req.headers["user-agent"] + "</li></ul></p></div><hr><small>This is an automated message. Do NOT reply to this email. If you didn't create an account ignore the email</small>",
            };

            transporter.sendMail(mailOptions, function (error, info) {
              if (error) {
                console.log(error);
              } else {
                console.log("Email sent: " + info.response);
              }
            });
            res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>POCOChat</title>
                <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.2.2/dist/css/bootstrap.min.css" rel="stylesheet"
                    integrity="sha384-Zenh87qX5JnK2Jl0vWa8Ck2rdkQ2Bzep5IDxbcnCeuOxjzrPF/et3URy9Bv1WTRi" crossorigin="anonymous">
                <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.9.1/font/bootstrap-icons.css">
            </head>
            <body class="bg-success text-white">
                <div class="row align-items-center w-100 vh-100">
                    <div class="w-100 text-center">
                        <i class="bi bi-envelope-exclamation" style="font-size:4em"></i>
                        <h1 class="fw-bold text-uppercase">E-mail sent</h1>
                        <p class="fs-5">Please open the link in your mail to reset your password.</p>
                    </div>
                </div>
            </body>
            </html>`)
        }
        else {
            res.setHeader("content-type", "application/json");
            res.status(404).send(JSON.stringify({error: "This username is not on POCOChat ..."}))
        }
    }
    catch (e) {
        res.setHeader("content-type", "application/json");
        res.status(500).send(e);
        console.error(e)
    }
})

app.get('/badges/*', (req, res) => {
    res.sendFile(path.join(__dirname, "badges/" + req.params["0"]));
})

app.get('/emojilist', (req, res) => {
    let response = `<script>
    function myFunction() {
        var input, filter, ul, li, a, i, txtValue;
        input = document.getElementById("myInput");
        filter = input.value.toUpperCase();
        ul = document.getElementById("emojis");
        li = ul.getElementsByTagName("a");
        for (i = 0; i < li.length; i++) {
            a = li[i];
            txtValue = a.href || a.getAttribute("href");
            if (txtValue.toUpperCase().indexOf(filter) > -1) {
                a.style.display = "";
            } else {
                a.style.display = "none";
            }
        }
    }
    </script><style>*{margin:0;padding:0}input{border:0;width:98%;border-radius:3px;padding:2px;background-color:rgb(122, 122, 122, 0.5);}</style><input type='search' onkeyup="myFunction()" id="myInput" placeholder='Search Emojis'><br><br><div id="emojis">`;
    fs.readdirSync(path.join(__dirname, "emojis")).forEach((emoji) => {;
        if (!emoji.startsWith(".")) response += `<a href="emojis/${emoji}"><img src="emojis/${emoji}" height="32" width="32"></a>`; //  :` + emoji.split(".")[0] + ":"
    })
    response += "</div>"
    res.send(response);
})

function wrapURL(text) { 
 
	// Create your regex pattern for urls 
	let urlPattern = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;
    
    let msgType = "text";

    let youtubeURLRegex = /^.*(youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
 
    // Check string for any url patterns and wrap them in anchor tags except anonfiles
    let result = text.replace(urlPattern, function(url){

        let ytRegexMatch = url.match(youtubeURLRegex);
        let headers;
        let allowUseHeader = true;

        try {
            new URL(url)
        }
        catch {
            return url;
        }

        try {
            headers = request("HEAD", url, {
                timeout: 500
            }).headers;
        }
        catch {
            allowUseHeader = false; // something went wrong idk what
        }


        if (allowUseHeader && headers["content-type"] === undefined)
            allowUseHeader = false;

        if (allowUseHeader && headers["content-type"].startsWith("image/") && msgType === "text") {
            msgType = "image";
            return "{\"type\": \"image\", \"src\": \"" + url + "\", \"caption\": \"";
        }
        if (allowUseHeader && headers["content-type"].startsWith("video/") && msgType === "text") {
            msgType = "video";
            return "{\"type\": \"video\", \"src\": \"" + url + "\", \"caption\": \"";
        }
        if (allowUseHeader && headers["content-type"].startsWith("audio/") && msgType === "text") {
            msgType = "audio";
            return "{\"type\": \"audio\", \"src\": \"" + url + "\", \"caption\": \"";
        }
        if (new URL(url.trim()).hostname === "anonfiles.com" && msgType === "text") {
            try {
                // this is an anonfiles url, get info and based on that decide what to do
                const anonurl = new URL(url);
                const anonid = anonurl.pathname.split("/")[1];
                const html = request("GET", url).getBody();
                const dom = new jsdom.JSDOM(html);
                const directUrl = dom.window.document.getElementById("download-url").getAttribute("href");
        
                if (directUrl.toLowerCase().endsWith(".jpg")
                 || directUrl.toLowerCase().endsWith(".jpeg")
                 || directUrl.toLowerCase().endsWith(".png")
                 || directUrl.toLowerCase().endsWith(".gif")
                 || directUrl.toLowerCase().endsWith(".webp")
                 || directUrl.toLowerCase().endsWith(".tiff")
                 || directUrl.toLowerCase().endsWith(".bmp")) 
                {
                    msgType = "image";
                    return "{\"type\": \"image\", \"src\": \"" + directUrl + "\", \"caption\": \"";
                }
                if (directUrl.toLowerCase().endsWith(".mp4")
                || directUrl.toLowerCase().endsWith(".ogg")
                || directUrl.toLowerCase().endsWith(".webm")
                || directUrl.toLowerCase().endsWith(".mov")) 
                {
                    msgType = "video";
                    return "{\"type\": \"video\", \"src\": \"" + directUrl + "\", \"caption\": \"";
                }
                if (directUrl.toLowerCase().endsWith(".mp3")
                || directUrl.toLowerCase().endsWith(".wav")) 
                {
                    msgType = "audio";
                    return "{\"type\": \"audio\", \"src\": \"" + directUrl + "\", \"caption\": \"";
                }
        
                // return `<a href="${directUrl.trim()}" target="_blank" download class="btn fs-4 text-white"><i class="bi bi-file-earmark-arrow-down"></i> ` + dom.window.document.querySelector("#site-wrapper > div.row.top-wrapper > div.col-xs-12.col-md-6 > h1").textContent + `</a> `;
                msgType = "file";
                return "{\"type\": \"file\", \"src\": \"" + directUrl + "\", \"name\": \"" + dom.window.document.querySelector("#site-wrapper > div.row.top-wrapper > div.col-xs-12.col-md-6 > h1").textContent.replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;") + "\"}";

            }
            catch (e) {
                // anonfiles error
                console.log(e)
                return `<a href="${url.trim()}" target="_blank">${url.trim()}</a> `;
            }
        }
        else if ((ytRegexMatch && ytRegexMatch[2].length == 11) && msgType === "text") {
            // this is an youtube url, get info and based on that decide what to do
            const jsonData = JSON.parse(request("GET", "https://noembed.com/embed?url=" + url.trim()).getBody());

            msgType = "youtube";
            let jsonS = JSON.stringify({
                type: "youtube",
                url: url.trim(),
                videoId: ytRegexMatch[2],
                title: jsonData.title,
                channel: jsonData.author_name,
                caption: ""
            })
            return jsonS.slice(0, jsonS.length - 2);
        }
        else {
            if (msgType === "text") {
                return `<a href="${url.trim()}" target="_blank">${url.trim()}</a> `;
            }
            else if (msgType != "file" && msgType != "youtube") {
                return url.trim();
            }
            else if (msgType == "youtube") {
                let rjson = JSON.parse(result);
                if (rjson.caption === undefined)
                    rjson.caption = "";
                rjson.caption += url.trim();
                result = JSON.stringify(rjson);
                return "";
            }
        }
    }); 

    if (msgType != "text" && msgType != "file") {
        result += "\"}";
        if (!result.startsWith("{")) {
            result = "{" + result.split("{")[1]
        }
        result = result.replaceAll("\n", "<br>");
        const resultJSON = JSON.parse(result);
        resultJSON.caption = resultJSON.caption.trim();
        result = JSON.stringify(resultJSON);
        console.log(result);
        result = JSON.parse(result);
    }
    else if (msgType === "file") {
        result = JSON.parse(result);
    }

    return result; 
} 

app.get("/no-profile.jpg", (req, res) => {
    res.sendFile(path.join(__dirname, "no-profile.jpg"));
});

/* app.post('/send', (req, res) => {
    let data = JSON.parse(req.body);
    const person = people.find(p => p.uuid === data.uuid);
    console.log(person);
    if (person != undefined) {
        switch (data.html) {
            case "!clear":
                fs.writeFileSync(path.join(__dirname, "chat.json"), JSON.stringify([
                    {
                        type: "system-message",
                        html: person.username + " cleared chat."
                    }
                ]))
                break;
            default:
                let formattedMsg = "";
                if (data.html.startsWith("!em ")) {
                    const emoji = data.html.slice(4).trim();
                    data.html = "<img style='width:32px;height:32px' src='" + emoji + "'>";
                }
                else {
                    formattedMsg = data.html;
                    if (/<\/?[a-z][\s\S]*>/i.test(formattedMsg)) {
                        res.setHeader("content-type", "text/plain");
                        res.status(406).send("ERROR_CODE_INJECTION_BLOCKED"); // cant accept getting hacked
                        break;
                    }
                    if (formattedMsg.length >= 2000) {
                        res.status(406).send("ERROR_ILLEGAL_MESSAGE_LENGTH");
                    }
                    fs.readdirSync(path.join(__dirname, "emojis")).forEach((emoji) => {
                        if (emoji.split(".")[0] != "") {
                            formattedMsg = formattedMsg.replaceAll(":" + emoji.split(".")[0] + ":", `<img src="emojis/${emoji}" class="emoji">`);
                        }
                    });
                    if (formattedMsg.trim().includes("<div") || formattedMsg.trim().includes("</div>")) {
                        formattedMsg = formattedMsg.trim().replaceAll("<div", "<span").replaceAll("</div>", "</span>");
                    }
                    formattedMsg = formattedMsg.trim();
                    if (formattedMsg.startsWith("#")) {
                        const hashes = formattedMsg.split(" ")[0]
                        if (utils.allSame(hashes) && hashes.length <= 6) {
                            formattedMsg = "<h" + hashes.length + ">" + formattedMsg.slice(hashes.length + 1) + "</h" + hashes.length + ">"
                        }
                    }
                    formattedMsg = utils.whatsappStyles(formattedMsg, "_", "<i>", "</i>");
                    formattedMsg = utils.whatsappStyles(formattedMsg, "*", "<b>", "</b>");
                    formattedMsg = utils.whatsappStyles(formattedMsg, "~", "<s>", "</s>");
                    formattedMsg = utils.whatsappStyles(formattedMsg, "&", "<div class='shake d-inline-block'>", "</div>");
                    formattedMsg = utils.whatsappStyles(formattedMsg, "§", "<div class='shake red d-inline-block'>", "</div>");
                    formattedMsg = utils.whatsappStyles(formattedMsg, "|", "<div class='spoiler d-inline-block'>", "</div>");
                    const filter = new BadWordFilter({
                        placeHolder: "█"
                    });
                    filter.addWords(...extraBadWords);
                    filter.removeWords("hell", "god");
                    try {
                    formattedMsg = filter.clean(formattedMsg); // bad words aren't good
                    } catch {}
                    formattedMsg = wrapURL(formattedMsg);
                }
                if (typeof formattedMsg === "object") {
                    formattedMsg.time = Date.now();
                    formattedMsg.userid = data.uuid;
                    formattedMsg.username = person.username;
                    formattedMsg.badges = person.badges;
                    Chat(formattedMsg);
                    res.status(200);
                }
                else {
                    Chat({
                        type: "text",
                        html: formattedMsg,
                        time: Date.now(),
                        userid: data.uuid,
                        username: person.username,
                        badges: person.badges === undefined ? "" : person.badges
                    });
                    res.status(200);
                }
                // Chat("<div class='message-container'><div class='message'><small>[<xmp>" + person.username + "</xmp>] " + (person.badges === undefined ? "" : person.badges) + " @ " + formattedTime + "</small><br>" + formattedMsg + "</div></div>");
                break;
        }
    }
}) */ // deprecated

app.get("/bio/*", async (req, res) => {
    try {
        res.setHeader("Content-type", "text/plain");
    
        const username = req.params[0];
        const user = await usersCollection.findOne({
            username: username
        });
    
        if (user != undefined) {
            res.send(user.bio === undefined ? "" : user.bio)
        }
        else {
            res.send("");   
        }
    }
    catch (e) {
        console.log(e);
        res.send("");
    }
});

app.post("/bio", (req, res) => {
    const bioData = JSON.parse(req.body);
    const bioText = bioData.text;

    if (bioText != undefined && bioText.length <= 200) {
        const user = people.find(p => p.username === bioData.username);

        if (user != undefined && user.password === bioData.password) {
            if (usersCollection.findOne({ username: bioData.username }) != undefined) {
                usersCollection.updateOne(
                    { username: bioData.username },
                    { $set: 
                        { bio: bioText }
                    }
                );
                res.send("SUCCESS_BIO_CHANGED");
            }
            else {
                res.send("ERROR_AUTHENTICATION_FAILURE")
            }
        } 
        else {
            res.send("ERROR_AUTHENTICATION_FAILURE");
        }
    }
    else {
        res.send("ERROR_ILLEGAL_LENGTH");
    }
});

app.get('/chatstats', (req, res) => {
    res.setHeader("Content-type", "application/json");
    const usernames = []
    const cmds = JSON.parse(fs.readFileSync("commands.json").toString());
    people.forEach(person => {
        if (person.username != "")
            usernames.push(person.username);
    });
    res.send(JSON.stringify({
        people: {
            count: people.length,
            users: usernames
        },
        commands: cmds
    }));
})

app.post('/user/*', async (req, res) => {
    try {
        const u = await usersCollection.findOne({
            username: req.params[0]
        })
    
        if (u != undefined) {
            res.send(JSON.stringify({
                creationDate: u.date,
                lastJoinedDate: u.lastJoinedDate,
                lastLeftDate: u.lastLeftDate
            }))
        }
        else {
            res.status(404).send("ERROR_USER_NOT_FOUND")
        }
    }
    catch {
        res.status(400).send("ERROR_INVALID")
    }
})

app.post('/join', async (req, res) => {
    const uuid = uuidv4();
    let data;
    try {
        data = JSON.parse(req.body);
    }
    catch {
        res.status(500).send("ERROR_JSON_PARSE_FAILED")
        return;
    }

    if (
      data.username === undefined ||
      data.password === undefined ||
      data.socketId === undefined ||
      data.username === null ||
      data.password === null ||
      data.socketId === null ||
      typeof data.username != "string" ||
      typeof data.password != "string" ||
      typeof data.socketId != "string"
    ) {
      res.status(500).send("ERROR_JSON_PARSE_FAILED");
      return;
    }

    data.username = data.username.replaceAll(" ", "");

    const socks = io.sockets.sockets;
    console.log("doing the usersSock we have ", socks);
    let usersSock;
    socks.forEach(s => {
        if (s.id == data.socketId) {
            usersSock = s;
        }
    });

    if (usersSock === undefined) {
        res.status(406).send("ERROR_SOCKET_ID_FAIL")
        return;
    }

    if (usersSock.handshake.headers["user-agent"] != undefined)
      data.useragent = usersSock.handshake.headers["user-agent"];

    if (usersSock.handshake.headers["x-forwarded-for"] != undefined)
        data.ipdata = {
            ip: req.headers["x-forwarded-for"],
            ipSockets: usersSock.handshake.headers["x-forwarded-for"] != undefined
        };
    else
        data.ipdata = {
            ip: req.ip,
            ipSockets: usersSock.handshake.address
        }

    let atPass = true;

    if (data.password === "" && (data.authToken != undefined && data.authToken != null && typeof data.authToken === "string")) {
        await jwt.verify(data.authToken, tokenSecret, (err, d) => {
            if (err) {
                res.send("ERROR_PASSWORD_NOT_PROVIDED");
                atPass = false;
                return;
            }
            else
            {
                data.password = d.password;  
                atPass = true; 
            }
        })
    }

    if (!atPass)
        return;

    if (data.password.trim().length == 0) {
        res.status(406).send("ERROR_PASSWORD_NOT_PROVIDED");
        return;
    } 
    if (data.ipdata.ip === undefined) {
        res.status(406).send("ERROR_IP_ADDRESS_NOT_PROVIDED");
        return;
    }
    const user = await User(data);
    if (data.username === null) {
        return "ERROR_NAME_IS_ILLEGAL"
    }
    if (data.username.length >= 40) {
        res.send("ERROR_NAME_TOO_LONG")
        return;
    }
    if (
      data.username.includes("<") ||
      data.username.includes(">") ||
      data.username.includes("ㅤ") ||
      data.username.includes(" ") ||
      data.username.includes(" ") ||
      data.username.includes("᠎") || // this ISNT EMPTY
      data.username.includes(" ") ||
      data.username.includes(" ") ||
      data.username.includes(" ") ||
      data.username.includes(" ") ||
      data.username.includes(" ") ||
      data.username.includes(" ") ||
      data.username.includes(" ") ||
      data.username.includes(" ") ||
      data.username.includes("　") ||
      data.username.includes("ﾠ") ||
      data.username.includes("@") ||
      data.username.includes("#") ||
      data.username.includes(":") ||
      data.username.includes("\"") ||
      data.username.includes("'") ||
      data.username.includes("\\") ||
      data.username.includes("/") ||
      data.username.includes("&") ||
      data.username.includes("%") ||
      data.username.includes("(") ||
      data.username.includes(")") ||
      data.username.includes("[") ||
      data.username.includes("]") ||
      data.username.includes("{") ||
      data.username.includes("}") ||
      data.username.length == 0
    ) {
      res.send("ERROR_NAME_IS_ILLEGAL");
      return;
    }
    data.uuid = uuid;
    data.username = data.username.trim();
    const filter = new BadWordFilter();
    filter.addWords(...extraBadWords);
    const cleanUser = (() => {try{return filter.clean(data.username)} catch { return data.username }})();
    if (data.username != cleanUser) {
        res.send("ERROR_NAME_IS_ILLEGAL");
        return;
    }
    console.log(data);
    if (!user.allowLogin) {
      if (user.needsEmail) {
        res.status(406).send("ERROR_EMAIL_VERIFICATION_REQUIRED");
        return;
      }
      if (user.awaitingEmail) {
        res.status(406).send("ERROR_EMAIL_VERIFICATION_SENT");
        return;
      }
      res.status(406).send("ERROR_AUTHENTICATION_FAILURE");
      return;
    }
    data.badges = user.badges;
    if (people.find(p => p.username === data.username) != undefined && !user.allowLogin) {
        res.send("ERROR_USERNAME_ALREADY_USED")
        return;
    }
    else {
        // Chat("<div><small>[SYSTEM] <xmp>" + data.username + "</xmp> has joined Chatroom!</small></div>")
        Chat({
            type: "system-message",
            html: data.username + " has joined Chatroom!"
        })
        people.push(data); 
        io.emit('chat-update');

        let authToken = jwt.sign({
            username: data.username,
            password: data.password
        }, tokenSecret);

        res.send(JSON.stringify({
            uuid: uuid,
            roles: user.roles,
            authToken: authToken
        }));
    }
})

app.post('/leave', (req, res) => { // OUTDATED

    return;


    const uuid = req.body
    const possiblePerson = people.find(p => p.uuid === uuid);
    if (possiblePerson != undefined) {
        // Chat("<div><small>[SYSTEM] <xmp>" + possiblePerson.username + "</xmp> left Chatroom</small></div>");
        Chat({
            type: "system-message",
            html: possiblePerson.username + " left Chatroom"
        });
        io.emit('user-typing', {
            typing: false,
            username: possiblePerson.username
        })
        peopleTyping = peopleTyping.filter(e => e !== possiblePerson.username);

        people.splice(people.indexOf(possiblePerson), 1);
    }
    else {
        res.send("ERROR_UUID_NOT_FOUND")
    }
})

app.get('/profile_pics/*', (req, res) => {
    const file = fs.readdirSync(path.join(__dirname, "profile_pics")).find(pic => pic.startsWith(req.params[0]));
    if (file != undefined)
        res.sendFile(path.join(__dirname, "profile_pics/" + file));
    else
        res.status(404).sendFile(path.join(__dirname, "no-profile.jpg"))
})

app.get('/profile_pics/md5/*', (req, res) => {
    const file = fs.readdirSync(path.join(__dirname, "profile_pics")).find(pic => pic.startsWith(req.params[0]));
    res.headers['content_type', 'text/plain']
    if (file != undefined)
        res.send(md5f.sync(path.join(__dirname, "profile_pics/" + file)));
    else
        res.status(404)
})

app.get('/verify', async (req, res) => {
    const guy = await usersCollection.findOne({
        verifyCode: req.query["e"]
    })
    if (guy != undefined) {
        await usersCollection.updateOne({
            verifyCode: req.query["e"]
        }, {
            $set: {
                awaitingEmail: false
            },
            $unset: {
                verifyCode: ""
            }
        });
        io.to(
          guy.socketId
        ).emit("try-join");
        res.sendFile(path.join(__dirname, "verified.html"))
    }
})

app.post("/newpassword", async (req, res) => {
    try {
        const guy = await usersCollection.findOne({
            prt: req.body.token
        })
        if (guy != undefined && guy != null && req.body.password.length >= 1) {
            await usersCollection.updateOne({
                prt: req.body.token
            }, {
                $set: {
                    password: req.body.password
                },
                $unset: {
                    prt: ""
                }
            });
            res.send("Password has been changed!")
        }
        else {
            res.send("An error ourcurred. If you can't recover your account, please contact us on Discord for help.")
        }
    }
    catch (e) {
        res.send("ERROR_SERVER_EXCEPTION_CATCHED")
        console.log(e);
    }
})

app.get('/newpassword', async (req, res) => {
    const guy = await usersCollection.findOne({
        prt: req.query["e"]
    })
    if (guy != undefined && guy != null && req.query["e"] != undefined && req.query["e"] != null) {
        res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>POCOChat</title>
            <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.2.3/dist/css/bootstrap.min.css" rel="stylesheet" integrity="sha384-rbsA2VBKQhggwzxH7pPCaAqO46MgnOM80zW1RWuH61DGLwZJEdK2Kadq2F9CUG65" crossorigin="anonymous">
        </head>
        <body class="bg-light text-black">
            <div class="modal fade" id="modal" data-bs-backdrop="static" tabindex="-1" aria-labelledby="modall" aria-hidden="true">
                <div class="modal-dialog">
                  <div class="modal-content">
                    <div class="modal-body">
                        <img src="logo-sm.svg" alt="POCOChat logo" height="80">
                        <br><br>
                        <h1>Change password</h1>
                        <p>
                            Please enter a new password.
                        </p>
                        <form action="/newpassword" method="post">
                            <input type="hidden" name="token" value="${req.query["e"]}" /> <!--don't change or it wont work-->
                            <input type="password" id="password" name="password" value="" placeholder="Password">
                            <input type="submit" value="Finish">
                        </form>
                    </div>
                  </div>
                </div>
                <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.2.3/dist/js/bootstrap.bundle.min.js" integrity="sha384-kenU1KFdBIe4zVF0s0G1M5b4hcpxyD9F7jL+jjXkk+Q2h455rYXK/7HAuoJl+0I4" crossorigin="anonymous"></script>
            </div>
            <script>
                new bootstrap.Modal(document.querySelector("#modal")).show()
            </script>
        </body>
        </html>
        `)
    }
    else {
        res.status(403).send("Password recovery token invalid or missing, can't continue. If you can't recover your account, please contact us on Discord for help.")
    }
})

app.post('/profile_pics', async (req, res) => {
    try {
        if (req.files.file && req.files.file.mimetype.startsWith("image/")) {
            const user = await User({username: req.headers["data-authentication-username"], password: req.headers["data-authentication-password"], usingAPI: true});
    
            if (user.allowLogin) {
                if (req.files.file.size <= 2048000) {
                    const file = fs.readdirSync(path.join(__dirname, "profile_pics")).find(pic => pic.startsWith(user.username));
                    if (file != undefined) fs.unlinkSync(path.join(__dirname, "profile_pics/" + file));
                    req.files.file.mv(path.join(__dirname, "profile_pics/" + user.username.replaceAll(" ", "") + "." + req.files.file.name.split(".").pop()), (err) => {
                        if (err) {
                            res.status(418).send(err)
                        }
                        else {
                            res.status(200).send("SUCCESS_PROFILE_UPDATED")
                        }
                    });
                }
                else {
                    res.status(406).send("ERROR_IMAGE_EXCEEDS_MAX")
                }
            }
            else {
                res.status(406).send("ERROR_AUTHENTICATION_FAILURE")
            }
        }
        else {
            res.status(404).send("ERROR_NO_FILE_OR_INVALID_MIMETYPE")
        }
    }
    catch (e) {
        res.status(404).send("ERROR_NO_FILE_OR_INVALID_MIMETYPE");
        console.log(e);
    }
})
  
http.listen(port, () => {
    console.log(`POCOChat listening on port`, port)
})

function Chat(json) {
    /*
    let chatJsonEdit = JSON.parse(fs.readFileSync(path.join(__dirname, "chat.json")).toString())
    console.log("add:", json);
    chatJsonEdit.push(json);
    fs.writeFileSync(path.join(__dirname, "chat.json"), JSON.stringify(chatJsonEdit));
    */
   chatCollection.insertOne(json).then(() => io.emit('chat-update'));
}


var transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.MAILER_ADDR,
    pass: process.env.MAILER_PW,
  },
});

async function User(data) {
    const user = await usersCollection.findOne({
        username: data.username
    });

    if (data.usingAPI) {
        if (user != undefined) {
            if (user.password != undefined && user.password === data.password) {
                data.allowLogin = true;
                return data;
            }
            else {
                data.allowLogin = false;
                return data;
            }
        }
        else {
            data.allowLogin = false;
            return data;
        }
    }

    if (people.find(p => p.username === data.username)) {
        data.allowLogin = false;
        data.alreadyLoggedIn = true;
        return data;
    }

    data.date = Date.now();


    if (user != undefined) {
      if (user.awaitingEmail) {
        usersCollection.deleteOne(user);
        data.allowLogin = false;
        return data;
      }
      if (user.password == data.password && data.password != "") {
        usersCollection.updateOne({
            username: data.username
        },
        {
            $set: {
                lastJoinedDate: Date.now(),
                currentState: "online",
                ipdata: data.ipdata,
                useragent: data.useragent,
                socketId: data.socketId
            }
        })
        user.allowLogin = true;
        return user;
      } else {
        data.allowLogin = false;
        return data;
      }
    } else if (data.email === undefined) {
      data.allowLogin = false;
      data.needsEmail = true;
      return data;
    } else {
        data.allowLogin = false;
        data.awaitingEmail = true;
        data.verifyCode = (uuidv4() + Date.now())
          .split("")
          .sort(function () {
            return 0.5 - Math.random();
          })
          .join("");
        ;

        var mailOptions = {
          from: process.env.MAILER_ADDR,
          to: data.email,
          subject: "Verify your POCOChat account",
          text:
            "Open this URL to verify: https://chat.poco.ga/verify?e=" +
            data.verifyCode,
          html:
            '<div style="margin: 20px;">' + `<svg xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" xmlns="http://www.w3.org/2000/svg" xmlns:svg="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-chat-square-text" viewBox="0 0 16 16" version="1.1" id="svg6" sodipodi:docname="logo.svg" inkscape:version="1.2 (dc2aeda, 2022-05-15)">
            <defs id="defs10"/>
            <sodipodi:namedview id="namedview8" pagecolor="#505050" bordercolor="#eeeeee" borderopacity="1" inkscape:showpageshadow="0" inkscape:pageopacity="0" inkscape:pagecheckerboard="0" inkscape:deskcolor="#505050" showgrid="false" inkscape:zoom="20.1" inkscape:cx="6.0199005" inkscape:cy="6.2686567" inkscape:window-width="1387" inkscape:window-height="942" inkscape:window-x="0" inkscape:window-y="25" inkscape:window-maximized="0" inkscape:current-layer="svg6"/>
            <path d="m 14.378754,3.632995 a 0.91167942,0.97565487 0 0 1 0.689534,1.1658807 l -1.599591,7.6152063 a 0.91167942,0.97565487 0 0 1 -1.089432,0.73792 l -2.223707,-0.53495 a 1.8233588,1.9513097 0 0 0 -1.5831315,0.419153 l -2.196488,2.004603 -1.183547,-2.817726 A 1.8233588,1.9513097 0 0 0 3.929178,11.119193 L 1.7054708,10.584243 A 0.91167942,0.97565487 0 0 1 1.0159368,9.4183626 L 2.6155278,1.8031567 A 0.91167942,0.97565487 0 0 1 3.7049596,1.0652358 Z M 3.9049085,0.11333513 A 1.8233588,1.9513097 0 0 0 1.7260449,1.5891767 L 0.12645386,9.2043826 A 1.8233588,1.9513097 0 0 0 1.5055219,11.536144 l 2.2237072,0.534949 a 0.91167942,0.97565487 0 0 1 0.6316068,0.551945 l 1.183547,2.817726 a 0.91167942,0.97565487 0 0 0 1.4231726,0.342368 l 2.1964881,-2.004603 a 0.91167942,0.97565487 0 0 1 0.7915657,-0.209576 l 2.2237077,0.53495 A 1.8233588,1.9513097 0 0 0 14.35818,12.628061 L 15.957771,5.0128556 A 1.8233588,1.9513097 0 0 0 14.578703,2.6810943 Z" id="path2" style="fill:#000000;stroke-width:0.943125;stroke:none"/>
            <g aria-label="p" id="text395" style="font-size:12px;font-family:'Apple Color Emoji';-inkscape-font-specification:'Apple Color Emoji';text-align:center;text-anchor:middle;fill:#000000;stroke:none"/>
            <rect style="fill:#000000;fill-opacity:1;stroke:none;stroke-width:2.9182;stroke-opacity:1" id="rect2012" width="1.1116071" height="7.8039351" x="5.872087" y="7.5975428" ry="0.10005045"/>
            <path style="color:#000000;fill:#000000;-inkscape-stroke:none;stroke:none" d="m 9.5136719,4.0410156 c -2.0011283,0 -3.6367188,1.6355905 -3.6367188,3.6367188 0,2.0011282 1.6355905,3.6347656 3.6367188,3.6347656 2.0011281,0 3.6347661,-1.6336374 3.6347661,-3.6347656 0,-2.0011283 -1.633638,-3.6367188 -3.6347661,-3.6367188 z m 0,1.1230469 c 1.3942421,0 2.5117191,1.1194302 2.5117191,2.5136719 0,1.3942416 -1.117477,2.5117186 -2.5117191,2.5117186 C 8.1194302,10.189453 7,9.071976 7,7.6777344 7,6.2834927 8.1194302,5.1640625 9.5136719,5.1640625 Z" id="path2016"/>
            <path d="m 14.396342,3.6018006 a 0.91167942,0.97565487 0 0 1 0.689534,1.1658807 l -1.599591,7.6152057 a 0.91167942,0.97565487 0 0 1 -1.089432,0.73792 l -2.223707,-0.53495 A 1.8233588,1.9513097 0 0 0 8.5900155,13.00501 L 6.3935277,15.009613 5.2099807,12.191887 A 1.8233588,1.9513097 0 0 0 3.9467671,11.087998 L 1.7230599,10.553049 A 0.91167942,0.97565487 0 0 1 1.0335259,9.3871682 L 2.6331169,1.7719623 A 0.91167942,0.97565487 0 0 1 3.7225487,1.0340414 Z M 3.9224976,0.08214074 A 1.8233588,1.9513097 0 0 0 1.743634,1.5579823 L 0.14404296,9.1731882 A 1.8233588,1.9513097 0 0 0 1.523111,11.504949 l 2.2237072,0.534949 a 0.91167942,0.97565487 0 0 1 0.6316068,0.551945 l 1.1835467,2.817726 a 0.91167942,0.97565487 0 0 0 1.423173,0.342368 l 2.1964878,-2.004603 a 0.91167942,0.97565487 0 0 1 0.791566,-0.209576 l 2.2237065,0.53495 a 1.8233588,1.9513097 0 0 0 2.178863,-1.475842 L 15.975359,4.9816612 A 1.8233588,1.9513097 0 0 0 14.596291,2.6498999 Z" id="path2-9" style="fill:#000000;stroke:none;stroke-width:0.943125"/>
            <g aria-label="p" id="text395-3" style="font-size:12px;font-family:'Apple Color Emoji';-inkscape-font-specification:'Apple Color Emoji';text-align:center;text-anchor:middle;fill:#000000;stroke:none" transform="translate(0.01758906,-0.03119439)"/>
            <rect style="fill:#000000;fill-opacity:1;stroke:none;stroke-width:2.9182;stroke-opacity:1" id="rect2012-8" width="1.1116071" height="7.8039351" x="5.8896766" y="7.5663486" ry="0.10005045"/>
            <path style="color:#000000;fill:#000000;stroke:none" d="m 9.5312605,4.0098212 c -2.0011278,0 -3.6367178,1.6355905 -3.6367178,3.6367188 0,2.0011282 1.63559,3.634765 3.6367178,3.634765 2.0011275,0 3.6347655,-1.6336368 3.6347655,-3.634765 0,-2.0011283 -1.633638,-3.6367188 -3.6347655,-3.6367188 z m 0,1.1230469 c 1.3942415,0 2.5117185,1.1194302 2.5117185,2.5136719 0,1.3942416 -1.117477,2.511719 -2.5117185,2.511719 -1.3942408,0 -2.5136718,-1.1174774 -2.5136718,-2.511719 0,-1.3942417 1.119431,-2.5136719 2.5136718,-2.5136719 z" id="path2016-0"/>
          </svg>` + '<h1>Hey!</h1><p>Are you trying to use POCOChat?<br><br><br><br><a style="background-color: #ac00ff;padding:10px;color:white;font-size:15pt;border-radius:3px;text-decoration:none;" target="_blank" href="https://chat.poco.ga/verify?e=' +
            data.verifyCode +
            '">Verify account</a><br><br> or copy this into your browser: https://chat.poco.ga/verify?e=' +
            data.verifyCode +
            "</p></div><hr><small>This is an automated message. Do NOT reply to this email. If you didn't create an account ignore the email</small>",
        };

        transporter.sendMail(mailOptions, function (error, info) {
          if (error) {
            console.log(error);
          } else {
            console.log("Email sent: " + info.response);
          }
        });

        usersCollection.insertOne(data);
        return data;
    }
}

/* setInterval(cleanUsers,10000);

async function cleanUsers() {
    pongList = [];
    const socketsWhenPongStarted = io.sockets.sockets;
    setTimeout(() => {
        socketsWhenPongStarted.forEach(socket => {
            if (!pongList.includes(socket.id)) {
                console.log(socket.id, "kicked because no callback on ping");
                socket.disconnect();
            }
        });
    }, 5000);
} */ // shit code moment