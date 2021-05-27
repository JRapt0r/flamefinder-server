# FlameFinder Server
Back end code for [FlameFinder](https://github.com/JRapt0r/flamefinder). Handles query construction, proxy requests, full-text search, and more.

## Overview

- Built with Node.js + Express + SQLite
- Constructs queries using Knex.js 
- Utilizes Helmet and express-rate-limit for enhanced security
- Able to make proxy requests to UIC's official course catalog API

## Requirements
[Node.js](https://nodejs.org/en/ "Node.js") 12+

[npm](https://nodejs.org/en/ "npm") (bundled with Node.js)

## Usage

Clone this repository and then use the following commands:

``` bash
# Navigate to the root directory
cd flamefinder-server

# install dependencies
npm install # or yarn

# start development server
npm run dev

# deploy the server
npm run start
```

## License

GPLv3
