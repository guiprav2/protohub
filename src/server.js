import cors from 'cors';
import crypto from 'crypto';
import errorMiddleware from './errorMiddleware.js';
import express from 'express';
import feathersService from './feathersService.js';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import scrub from './scrubber.js';

let app = express();
let port = process.env.PORT || 3000;
let trustProxy = JSON.parse(process.env.TRUST_PROXY || '0');
let rateLimitWindow = JSON.parse(process.env.RATE_LIMIT_WINDOW || '60000');
let rateLimitMaxReqs = JSON.parse(process.env.RATE_LIMIT_MAX_REQS || '50');
let scrubPasswords = x => scrub(x, ['password'], 'test');

if (trustProxy) {
  app.enable('trust proxy');
}

app.use(rateLimit({
  windowMs: rateLimitWindow,
  max: rateLimitMaxReqs,
}));

app.use(helmet());
app.use(cors());

app.use(express.json());

app.use((req, res, next) => {
  req.id = crypto.randomUUID();
  scrubPasswords(req.query);
  if (req.body) { scrubPasswords(req.body) }
  next();
});

app.use((req, res, next) => {
  let url = new URL(`http://unused/${req.originalUrl}`);
  let path = decodeURIComponent(url.pathname).slice(1);

  console.log(req.method, path, JSON.stringify({
    ip: req.ip,
    method: req.method,
    path,
    query: req.query,
    body: req.body,
    reqId: req.id,
  }));

  next();
});

app.get('/status', (req, res) => res.send('OK'));
app.post('/:ns/log', (req, res) => res.sendStatus(204));

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

app.put('/:ns/:collection/:id', async (req, res) => {
  try {
    let { ns, collection, id } = req.params;
    let sv = await feathersService(ns, collection);

    res.send(await sv.update(id, req.body, {
      nedb: { upsert: true },
    }));
  }
  catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

app.get('/:ns/:collection/:id', async (req, res) => {
  try {
    let { ns, collection, id } = req.params;
    let sv = await feathersService(ns, collection);

    res.send(await sv.get(id));
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

app.use(errorMiddleware);

app.listen(port);
console.log(`Listening on :${port}...`);
