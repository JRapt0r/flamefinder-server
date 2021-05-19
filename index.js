require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const app = express();
const port = process.env.PORT || 4000;

// Allow multiple CNAMEs
const allowed_origins = ["https://flamefinder.xyz", "https://www.flamefinder.xyz"];

const corsOptions = { origin: (origin, callback) => {
    if (allowed_origins.includes(origin))
      callback(null, true);
    else
      callback(new Error("CORS Error"));
  }
}

// Restrict CORS/use helmet in production
if (process.env.DOKKU_APP_TYPE === "herokuish") {
    app.use(cors(corsOptions));
    app.use(helmet());
}
else {
    app.use(cors());
}

app.use("/", require("./routes/api.js"));

app.get("*", (req, res) => res.status(404).json({ code: 404, msg: "Not Found" }));

app.listen(port, () => {
    console.log(`Listening on port ${port}`);
});