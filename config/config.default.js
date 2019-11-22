'use strict';


/**
 * egg-arango default config
 * @member Config#arango
 * @property {String} SOME_KEY - some description
 */
exports.arango = {
  app: true,
  agent: false,
  client: {
    url: 'http://localhost:8529',
    username: 'user',
    password: 'pwd',
    database: 'dbName',
  },
};
