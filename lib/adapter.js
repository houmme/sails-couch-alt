/**
 * Module Dependencies
 */
var nano = require('nano');
var async = require('async');

var helper = require('./helper');
var query = require('./query');

//bypass the Logging, if sails is not available
var logger = 'undefined' !== typeof sails? sails.log : console;
if (!logger.debug)
		logger.debug = console.log;
/**
 * waterline-sails-couch-alt
 *
 * For many adapters, this file is all you need.  For very complex adapters, you may need more flexiblity.
 * In any case, it's probably a good idea to start with one file and refactor only if necessary.
 * If you do go that route, it's conventional in Node to create a `./lib` directory for your private submodules
 * and load them at the top of the file with other dependencies.  e.g. var update = `require('./lib/update')`;
 */
module.exports = (function() {
	//current connections
	var connections = {};
	var definitions = []; //local cache of all definitions
	var adapter = {

		// IMPORTANT:
		// `migrate` is not a production data migration solution!
		// In production, always use `migrate: safe`
		//
		// drop   => Drop schema and data, then recreate it
		// alter  => Drop/add columns as necessary.
		// safe   => Don't change anything (good for production DBs)
		//
		syncable: false,
		reservedAttributes: ['id', 'rev', 'doc_type', 'doc_hash'],

		// Default configuration for connections
		defaults: {
			port: 5984,
			host: 'localhost',
			https: false,
			username: null,
			password: null,
			database: 'default',
			schema: true,
			syncable: false,
			autoPK: false,
			pkFormat: 'string',

			maxMergeAttempts: 5,
		},

		/**
		 *
		 * This method runs when a model is initially registered
		 * at server-start-time.  This is the only required method.
		 *
		 * @param  {[type]}   connection [description]
		 * @param  {[type]}   collection [description]
		 * @param  {Function} cb         [description]
		 * @return {[type]}              [description]
		 */
		registerConnection: function(connection, collections, cb) {

			if (!connection.identity) return cb(new Error('Connection is missing an identity.'));
			if (connections[connection.identity]) return cb(new Error('Connection is already registered.'));
			var url = helper.urlForConfig(connection);
			var conn = nano(url);
			var db;
			//ensure database exists or create it
			this.ensureDB(conn, connection.database, function(err) {
				if (err)
					return cb(err);
				db = conn.use(connection.database);

				connections[connection.identity] = db;
				//check and update metadata
				async.each(Object.keys(collections),
					function(model, cb) {
						adapter.registerSingleCollection(connection.identity, model, collections[model], cb);
					},
					function(err) {
						if (err) {
							//console.log("Problem!");
							return cb(new Error("Problem when registering Collections. " + err));
						}
						//create the default view for fetching by type
						var view = helper.buildView('by_type', function(doc) {
							emit(doc.doc_type, doc._id);
						});
						helper.createView(db, view, 'metadata', function(err) {
							if (err)
								return cb(err);
							logger.info("Done registering connection");
							cb();
						});
					});
			});

		},

		ensureDB: function(connection, dbName, cb) {
			connection.db.list(function(err, body) {
				if (err)
					return cb(err);
				if (body.indexOf(dbName) > -1)
					return cb(); //Database exists, hence ensured

				connection.db.create(dbName, function(err) {
					if (err)
						return cb(err);
					cb();
				});
			});
		},

		/* Register a collection in the db, create metadata document, create design doc for fetch by name */
		registerSingleCollection: function(connectionName, collectionName, collection, cb) {
			var db = connections[connectionName];
			metadata = collection.definition;
			metadata['name'] = collectionName;
			metadata['doc_type'] = 'metadata';
			helper.upsert(db, metadata, 'metadata/' + collectionName, function(err, body, header) {
				if (err) {
					return cb(err);
				}
				definitions[collectionName] = metadata;
				logger.info('created metadata for ' + collectionName);
				cb();
			}, true);
		},


		// Teardown a Connection
		teardown: function(conn, cb) {
			if (typeof conn == 'function') {
				cb = conn;
				conn = null;
			}
			if (!conn) {
				connections = {};
				return cb();
			}
			if (!connections[conn]) return cb();
			delete connections[conn];
			cb();
		},


		// Return attributes
		describe: function(connectionName, collectionName, cb) {
			//fetch by the view _type == 'metadata' && name == collection.name
			return cb(null, definitions[collectionName]);
		},

		define: function(connectionName, collectionName, definition, cb) {
			//create a collection
			return this.registerSingleCollection(connectionName, collectionName, definition, cb);
		},

		/**
		 *
		 * REQUIRED method if integrating with a schemaful
		 * (SQL-ish) database.
		 *
		 */
		drop: function(connectionName, collectionName, relations, cb) {
			//TODO: Maybe add a function to delete the metadata object
			//steps
			//1. Find all documents where type=collectionName
			//2. Delete all those documents
			//3. Delete metadata object for the collection
			//4. Remove metadata from definitions array
			var db = connections[connectionName];
			this.find(connectionName, collectionName, null, function(err, docs) {
				if (err)
					return cb(err);
				//TODO: replace with bulk methods
				docs.map(function(doc) {
					var obj = helper.prepare(doc, collectionName, definitions[collectionName]);
					helper.delete(db, obj, collectionName + '/' + obj._id, function(err) {
						if (err)
							return cb(err);
					});
				});
			});
			helper.delete(db, definitions[collectionName], 'metadata/' + collectionName, function(err) {
				if (err)
					return cb(err);
			});
			delete definitions[collectionName];
			return cb();
		},

		/**
		 *
		 * REQUIRED method to call Model.find(), Model.findOne(),
		 * or related.
		 * Must Implelment
		 * Waterline core will take care of supporting all the other different
		 * find methods/usages.
		 *
		 */
		find: function(connectionName, collectionName, options, cb) {
			//from the options build the name of the view
			//call the view
			//return object
			logger.debug("Find ", connectionName, collectionName, options);
			var db = connections[connectionName];
			query.find(db, collectionName, options, function(err, rows) {
				if (err)
					return cb(err);
				return cb(null, rows.map(function(doc) {
					return helper.preprocess(doc, definitions[collectionName]);
				}));
			});
		},

		create: function(connectionName, collectionName, values, cb) {

			logger.debug("Create ", connectionName, collectionName, values);
			var db = connections[connectionName];
			var obj = helper.prepare(values, collectionName, definitions[collectionName]);

			return helper.insert(db, obj, collectionName + '/' + obj._id, cb);
		},

		update: function(connectionName, collectionName, options, values, cb) {
			//update a document. Use deep merge if necessary
			logger.debug("Update ", connectionName, collectionName, values);

			var db = connections[connectionName];
			var obj = helper.prepare(values, collectionName, definitions[collectionName]);

			return helper.update(db, obj, collectionName + '/' + obj._id, cb);
		},

		destroy: function(connectionName, collectionName, options, cb) {
			//delete the document,
			//first find all the documents that meet the criteria
			logger.debug("Delete ", connectionName, collectionName, options);
			var db = connections[connectionName];
			this.find(connectionName, collectionName, options, function(err, docs) {
				if (err)
					return cb(err);
				//TODO: replace with bulk methods
				docs.map(function(doc) {
					var obj = helper.prepare(doc, collectionName, definitions[collectionName]);
					return helper.delete(db, obj, collectionName + '/' + obj._id, function(err) {
						if (err)
							return cb(err);
					});
				});
			});
			return cb();
		}

		/*

		// Custom methods defined here will be available on all models
		// which are hooked up to this adapter:
		//
		// e.g.:
		//
		foo: function (connection, collection, options, cb) {
		  return cb(null,"ok");
		},
		bar: function (connection, collection, options, cb) {
		  if (!options.jello) return cb("Failure!");
		  else return cb();
		  destroy: function (connection, collection, options, values, cb) {
		   return cb();
		 }

		// So if you have three models:
		// Tiger, Sparrow, and User
		// 2 of which (Tiger and Sparrow) implement this custom adapter,
		// then you'll be able to access:
		//
		// Tiger.foo(...)
		// Tiger.bar(...)
		// Sparrow.foo(...)
		// Sparrow.bar(...)


		// Example success usage:
		//
		// (notice how the first argument goes away:)
		Tiger.foo({}, function (err, result) {
		  if (err) return console.error(err);
		  else console.log(result);

		  // outputs: ok
		});

		// Example error usage:
		//
		// (notice how the first argument goes away:)
		Sparrow.bar({test: 'yes'}, function (err, result){
		  if (err) console.error(err);
		  else console.log(result);

		  // outputs: Failure!
		})




		*/




	};


	// Expose adapter definition
	return adapter;

})();
