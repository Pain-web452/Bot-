const express = require("express");
const bodyParser = require("body-parser");

const app = express();

app.use(bodyParser.json());
app.use(express.static("panels"));

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/panels/user.html");
});

app.get("/admin", (req, res) => {
  res.sendFile(__dirname + "/panels/admin.html");
});

app.post("/lockname", (req,res)=>{
  const {threadId,name} = req.body;

  console.log("Locking name:",name);

  res.json({status:"success"});
});

app.post("/locknick", (req,res)=>{
  const {uid,nick} = req.body;

  console.log("Locking nick:",nick);

  res.json({status:"success"});
});

const PORT = process.env.PORT || 3000;

app.listen(PORT,()=>{
  console.log("Server running on port",PORT);
});
