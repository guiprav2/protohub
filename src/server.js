import bodyParser from 'body-parser';
import cors from 'cors';
import express from 'express';
import feathersService from './feathersService.js';
import rateLimit from 'express-rate-limit';

let app = express();
let port = process.env.PORT || 3000;
let trustProxy = JSON.parse(process.env.TRUST_PROXY || 'false');
let rateLimitWindow = JSON.parse(process.env.RATE_LIMIT_WINDOW || '60000');
let rateLimitMaxReqs = JSON.parse(process.env.RATE_LIMIT_MAX_REQS || '50');

if (trustProxy) {
  app.enable('trust proxy');
}

app.use(rateLimit({
  windowMs: rateLimitWindow,
  max: rateLimitMaxReqs,
}));

app.use(cors());
app.use(bodyParser.json());

let reqLog = (msg, { req, ...more }) =>
  console.log(msg, JSON.stringify({ ip: req.ip, ...more }));

app.use((req, res, next) => {
  let url = new URL(`http://unused/${req.originalUrl}`);
  let path = decodeURIComponent(url.pathname).slice(1);

  console.log(req.method, path, JSON.stringify({
    ip: req.ip,
    method: req.method,
    path,
    query: req.query,
    body: req.body,
  }));

  next();
});

app.post('/:ns/:collection', async (req, res) => {
  try {
    let { ns, collection } = req.params;
    let sv = await feathersService(ns, collection);

    res.send(await sv.create(req.body, { query: req.query }));
  }
  catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

app.get('/:ns/:collection', async (req, res) => {
  try {
    let { ns, collection } = req.params;
    let sv = await feathersService(ns, collection);

    res.send(await sv.find({
      query: req.query,
      // TODO: pagination params
    }));
  }
  catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

app.patch('/:ns/:collection/:id', async (req, res) => {
  try {
    let { ns, collection, id } = req.params;
    let sv = await feathersService(ns, collection);

    res.send(await sv.patch(id, req.body));
  }
  catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

app.patch('/:ns/:collection', async (req, res) => {
  try {
    let { ns, collection } = req.params;
    let sv = await feathersService(ns, collection);

    if (!Object.keys(req.query).length) {
      throw new Error(`missing query`);
    }

    res.send(await sv.patch(null, req.body, { query: req.query }));
  }
  catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

app.delete('/:ns/:collection/:id', async (req, res) => {
  try {
    let { ns, collection, id } = req.params;
    let sv = await feathersService(ns, collection);

    res.send(await sv.remove(id, req.body));
  }
  catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

app.delete('/:ns/:collection', async (req, res) => {
  try {
    let { ns, collection } = req.params;
    let sv = await feathersService(ns, collection);

    if (!Object.keys(req.query).length) {
      throw new Error(`missing query`);
    }

    res.send(await sv.remove(null, req.body, { query: req.query }));
  }
  catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

app.listen(port);
console.log(`Listening on :${port}...`);
