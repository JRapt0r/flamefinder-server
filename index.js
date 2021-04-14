const express = require("express");
const cors = require("cors");
const app = express();
const port = process.env.PORT || 4000;

app.use(cors());

app.use("/api", require("./routes/api.js"));

app.get("*", (req, res) => res.json({ code: 404, msg: "Not Found" }));

app.listen(port, () => {
    console.log(`Listening on port ${port}`);
});