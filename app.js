'use strict';

module.exports = app => {
  // load dao to app
  require('./lib/load_dao')(app);

  // load arango to app
  require('./lib/arango')(app);
};
