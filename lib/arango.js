'use strict';

const assert = require('assert');
const { Database, aql } = require('arangojs');

let count = 0;

module.exports = app => {
  app.addSingleton('arango', createClient);
};

function createClient(config, app) {
  // connecting database
  assert(config.url && config.username && config.database,
    `[egg-arango] 'url: ${config.url}', 'username: ${config.username}', database: ${config.database}' must be configured!`);
  app.coreLogger.info('[egg-arango] connecting %s@%s:%s',
    config.url, config.username, config.database);
  const client = new Database({ url: config.url });
  client.useBasicAuth(config.username, config.password);
  client.useDatabase(config.database);

  app.beforeStart(function* () {
    const rows = yield client.query(aql`return DATE_ISO8601(DATE_NOW())`);
    const index = count++;
    app.coreLogger.info(`[egg-arango] instance[${index}] status OK, arango currentTime: ${rows[0]}`);
  });
  return client;
}
