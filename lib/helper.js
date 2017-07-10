/****************
Utility functions for the adapters
*/
var md5 = require('md5');
var extend = require('xtend');
var _ = require('lodash');
var uuid = require('uuid');

//bypass the Logging, if sails is not available
var logger = 'undefined' !== typeof sails ? sails.log : console;
if (!logger.debug)
  logger.debug = console.log;

module.exports = {
  /*Convert a config block to a nano specific connection string */
  urlForConfig: function(config) {
    var schema = 'http';
    if (config.https) schema += 's';

    var auth = '';
    if (config.username && config.password) {
      auth = encodeURIComponent(config.username) + ':' + encodeURIComponent(config.password) + '@';
    }

    return [schema, '://', auth, config.host, ':', config.port, '/'].join('');
  },
  /*shorthand to create/update views.
  use update=false, to replace existing doc */
  createView: function(db, viewObj, designDoc, cb, update) {
    if (!update)
      update = true;
    var key = '_design/' + designDoc;
    db.get(key, function(err, existing) {
      if (err && err['statusCode'] != 404) // any other error than not found, return
        return cb(err);
      var hash = module.exports.getHash(viewObj);
      if (update && existing && existing.doc_hash == hash) {
        logger.info('Hash matches view for ' + key + '. Skipping update');
        return cb();
      }

      if (!update) { //the view has to be replaced
        var tmp = {};
        tmp._rev = existing._rev;
        existing = tmp; //just retain the _rev parameter so that it updates
      }
      var obj = existing ? _.merge(existing, viewObj) : viewObj;

      module.exports.insert(db, obj, key, function(err, response) {
        if (err) {
          return cb(err);
        }
        logger.info('design document ' + key + ' added.');
        cb();
      }, hash);
    });

  },
  /* shortcut to build a view by passing view name and map function */
  buildView: function(name, map_func) {
    var view = {
      "views": {}
    };
    view.views[name] = {};
    view.views[name]["map"] = map_func;
    return view;
  },

  /* create a name for the view */
  getViewName: function(where) {
    return ['by'].concat(Object.keys(where).sort()).join('_');
  },
  /* create map function for the view */

  createViewMap: function(where, collectionName) {
    var keys = Object.keys(where).sort();
    var if_condition = ['if ('];
    keys.map(function(key, index) {
      if_condition = if_condition.concat(['doc.' + key, ' &&']);
      //if (index < keys.length - 1) //last element, dont add &&
      //  if_condition = if_condition.concat(['&&', ' ']);
    });
    //add final doctype filter
    if_condition = if_condition.concat(['doc.doc_type == "', collectionName, '"']);

    if_condition = if_condition.concat([')']);
    var emit = ['{', 'emit(['];
    keys.map(function(key, index) {
      emit = emit.concat(['doc.' + key]);
      if (index < keys.length - 1) //last element, dont add comma
        emit = emit.concat([',', ' ']);
    });
    emit = emit.concat([']', ', ', 'doc._id', ');', '}', ]);

    var body = if_condition.concat(emit).join('');
    var func = 'function(doc) {' + body + '}';
    logger.info('Generated emit function: ', func);

    return func;
  },
  getHash: function(data) {
    return data !== null && typeof data === 'object' ? md5(JSON.stringify(data)) : md5(data + ''); //quick string conversion
  },

  /*Quick helper for insert, to avoid dual computation,
  if a hash is passed, just use the passed hash */
  insert: function(db, obj, key, cb, hash) {
    if (!hash)
      hash = module.exports.getHash(obj);
    obj.doc_hash = hash;
    db.insert(obj, key, function(err, body, header) {
      if (err) {
        return cb(err);
      }
      //attach the _id and rev properties
      obj._id = body.id;
      obj._rev = body.rev;
      obj = module.exports.preprocess(obj);
      cb(null, obj); //switch the id back
    });
  },
  /* Prepare a document to be added to the database.
  Essentially, fix the id column.
  TODO: Convert any datetime objects to arrays here
  TODO: Eventually introduce logtime
  */
  prepare: function(obj, type, metadata) {
    var doc = extend({}, obj);
    if (doc.id) {
      doc._id = doc.id;
      delete doc.id;
      if (doc.attachments){
        doc._attachments = doc.attachments;
        delete doc.attachments;
      }
    } else {
      doc._id = uuid.v4();
    }
    doc.doc_type = type;
    return doc;
  },
  //preprocess the results of a query, primarily to fix the id,
  // and reverse the damages of prepare() above
  preprocess: function(obj, metadata) {
    var doc = extend({}, obj);
    doc.id = doc._id.split('/')[1]; //TODO: invalid assumption of only single / in id
    doc.attachments = doc._attachments;
    delete doc._attachments;
    delete doc._id;
    return doc;
  },

  delete: function(db, obj, key, cb) {
    //delete is just updating the document with _delete prop set to true
    //TODO: Find if this is the best choice.
    obj._deleted = true;
    return module.exports.update(db, obj, key, cb);
  },

  update: function(db, obj, key, cb) {
    if (obj._rev) //the object has a revision id, just try inserting
      return module.exports.insert(db, obj, key, cb);
    //if object does not have a rev id, continue to get it
    db.get(key, function(err, existing) {
      if (err || !existing) { // update should not be called on non existent objects
        if (!err && !existing)
          err = new Error('The object does not exist/not found');
        return cb(err);
      }
      obj._rev = existing._rev;
      module.exports.insert(db, obj, key, cb);
    });
  },

  /* Check if the key is present in database, if it is and check_hash is false
     Update. If check_hash is true, compare the calculated hash of data with
     the existing hash, if different, Update.
     If the key is not present, insert
     */
  getAttachmentData: function(db, obj, key, cb) {
    var filename = obj.filename;
    db.attachment.get(key, filename, function(err, body){
      if(err && err['statusCode'] != 404)
        return cb(err,null);
      return cb(null, body);
    });
  },

  upsert: function(db, obj, key, cb, check_hash) {
    db.get(key, function(err, existing) {
      if (err && err['statusCode'] != 404) // any other error than not found, return
        return cb(err);
      var hash = module.exports.getHash(obj);
      if (existing && check_hash && existing.doc_hash == hash) {
        logger.info('Hash matches for ' + key + '. Skipping');
        return cb(null, existing);
      }
      if (existing)
        obj._rev = existing._rev;
      module.exports.insert(db, obj, key, cb, hash);
    });

  }

};
