# 💬 POCOChat

POCOChat is a chatroom to find friends and discuss any topic as long as it meets the rules. Users can send text, pictures, videos, links, audio, documents and more.

> [!NOTE]
> POCOChat is longer maintained since 2023. You can fork the project if you want to revive it yourself.

## 👨‍💻 Deployment

1. Install Node.js
   - If you don't have Node.js installed on your server, you can download it from https://nodejs.org/en/download/ and follow the installation instructions for your operating system.

2. Install MongoDB
   - POCOChat uses MongoDB to store chat messages and user data. You can download and install MongoDB Community Edition from https://www.mongodb.com/try/download/community.

3. Clone the POCOChat repository
   - Open a terminal window and navigate to the directory where you want to store the POCOChat files.
   - Run the following command to clone the POCOChat repository: `git clone 
https://github.com/m-obeid/POCOChat.git`

4. Install dependencies
   - Navigate to the POCOChat directory by running `cd pocochat`.
   - Run the following command to install the project dependencies: `npm install`.
   - Run the following command to add missing folders: `md profile_pics`

5. Setup MongoDB
   - Run the following command to start the MongoDB shell: `mongosh`. If you are on Windows, navigate to the installation directory. and then run.
   - Run the following commands to create a database for POCOChat and a user with read and write permissions:
     ```
     use pocochat
     db.createUser({
       user: "<your-mongodb-username>",
       pwd: "<your-mongodb-password>",
       roles: [{ role: "readWrite", db: "pocochat" }]
     })
     ```
     - Replace `<your-mongodb-username>` and `<your-mongodb-password>` with a username and password of your choice.
   - Exit the MongoDB shell by running the `exit` command.

6. Configure environment variables
   - Copy the `.env.example` file to `.env` by running `cp .env.example .env`.
   - Edit the `.env` file and set the environment variables according to your setup. You will need to set the following variables:
     - `JWT_TOKENSECRET`: This is the token secret used to sign the JSON Web Tokens (JWT) for authentication. Set it to a long, random string.
     - `MAILER_ADDR`: This is the email address for the email service used to send verification emails. If you're using Gmail, set it to your Gmail address.
     - `MAILER_PW`: This is the password or app-specific password for the email service. If you're using Gmail, generate an app-specific password from your Google account settings.
     - `MONGO_CONSTR`: This is the connection string for your MongoDB database. You can use a local MongoDB server or a cloud-based service like MongoDB Atlas.
     - `SOCKET_ADMIN_USER`: This is the username for the Socket.IO dashboard. Set it to a username of your choice.
     - `SOCKET_ADMIN_PASSHASH`: This is the bcrypt hash for the password of the Socket.IO dashboard. You can generate a hash using an online bcrypt generator like https://www.browserling.com/tools/bcrypt.

7. Start the server
   - Run the following command to start the server: `npm start`.
   - The server should now be running on port 8910. You can access it by opening a web browser and navigating to `http://<servers-ip>:8910`.

That's it! POCOChat should now be up and running on your server. You can access it by navigating to your server's IP address or domain name on port 8910.

## ⌨️ How to Add Commands

To add commands to your chat, you need to add them in code first. Search for `!clear`, for example, which is a default command, and add your own statement. Then, in order to show it to users who type `!` in their keyboard, add it to `commands.json` too. It should be a JSON object like this one:

```
{
  "name": "clear",
  "arguments": [],
  "comment": "Clears the chat for everyone."
}
```

Once you're done, restart the server, and it should work.

## 😂 How to Add Emojis

Simply insert an image file into the `emojis` folder. Your filename should be `youremojiname.yourextension`, for example, the emoji :blobcookie: -> `blobcookie.png` or `blobcookie.gif`, etc.

## ✅ How to Add Badges

Also, just add image files to `badges`. You can assign users badges using MongoDB. For that, go into `pocochat` database, `users` collection, find your user, and add an HTML `img` tag with a height of 20 and a `src` of eg. `badges/yourrbadge.png`. Any HTML code may be inserted, but you should avoid anything unusual as it could lead to exploitation.

## 🛟 How to Add Roles

Currently, there's only the moderation role, but feel free to code your own. You can add them to your user object in MongoDB in an array named `roles`. By default, a user has no roles. The moderation role can kick users' IP addresses, delete messages, or send notices to warn users.

## 🤔 More details

POCOChat is now open-source and can be redistributed and rehosted as you wish, as long as:

- The credits still mention the original developers.
- It is not abused for illegal actions.

Please be aware that the code is very messy at some times because I did not expect this program to become popular and had to optimize its performance as soon as possible, which meant I didn't have time to organize the source code properly.

Contributions are welcomed to address this issue.
