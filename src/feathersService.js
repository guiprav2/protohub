import Collection from 'nedb';
import makeFeathersService from 'feathers-nedb';
import memoize from 'lodash/memoize.js';

let storagePath = `${process.cwd()}/storage`;

let serviceKey = (ns, collection) => `${ns}/${collection}`;

let feathersService = memoize(async (ns, collection) => {
  let k = serviceKey(ns, collection);

  let Model = new Collection({
    filename: `${storagePath}/collections/${k}.jsonl`,
  });

  await new Promise((resolve, reject) => {
    Model.loadDatabase(err => {
      if (err) {
        return reject(err);
      }

      resolve();
    });
  });

  return makeFeathersService({ Model, multi: true });
}, serviceKey);

export default feathersService;
