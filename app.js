'use strict';

module.exports = app => {
  // load dao files
  require('./lib/load_dao')(app);

  // connect database
  // if (app.config.arango.app && !app.arango) {
  if (app.config.arango.app) {
    require('./lib/arango')(app);
  }
};
