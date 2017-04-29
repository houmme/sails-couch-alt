![image_squidhome@2x.png](http://i.imgur.com/RIvu9.png)

# sails-couch-alt

Provides an alternate access mechanism to Apache Couchdb from Sails.js & Waterline.

The core idea is,

Create a single database for all models (than one database per model)
Identify models by an doc_type attribute
Create a doc_type == 'metadata' document for each document type (Analogous to _design docs)
Automatically generate simple indexed views that is accessible from the find function (Inspired by the original couchdb adapter)
Ability to switch between all couch variants supported by nano


### Installation

To install this adapter, run:

```sh
$ npm install sails-couch-alt (Not deployed in npm registry yet. Coming soon)
```




### Usage

This adapter exposes the following methods:

###### `find()`

Find by id, find by where conditions.
For each where condition, if a design doc is not present a new one is created,
using a templated map funcion. TODO: Add more flexibility in creating views


###### `create()`
Does a nano.insert() by updating the id to _id column.


###### `update()`
Does a nano.insert taking into account the _rev property


###### `destroy()`
Finds the records specified by the where condition and, sets the _deleted property.




### Interfaces

>TODO:
>Support local instance of pouchDB.
>Currently only passing the basic tests, implement queryable interfaces completely
>Optimize for speed.



### Running the tests

Configure the interfaces you plan to support (and targeted version of Sails/Waterline) in the adapter's `package.json` file:

```javascript
{
  //...
  "sails": {
  	"adapter": {
	    "sailsVersion": "~0.10.0",
	    "implements": [
	      "semantic",
	      "queryable"
	    ]
	  }
  }
}
```

In your adapter's directory, run:

```sh
$ npm test
```


### License

**[MIT](./LICENSE)**
&copy; 2014 [houm](http://github.com/houmme) & [contributors]
[vipinr](http://www.houm.me) & contributors

[Sails](http://sailsjs.org) is free and open-source under the [MIT License](http://sails.mit-license.org/).
