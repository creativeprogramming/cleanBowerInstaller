"use strict";

var fs = require("fs"),
	q = require("q"),
	path = require("path"),
	glob = require("glob"),
	regex = {
		startWithSlash: new RegExp("^\/.*"),
		containAsterisk: new RegExp("\\*", "g"),
		containDoubleAsterisk: new RegExp("[\\*]{2}", "g"),
		containMin: new RegExp("[.]min", "g")
	};

/**
 * Custom file copy method
 *
 * @param from {string}
 * @param to {string}
 * @returns {promise}
 */
function fileCopy(from, to) {
	var deferred = q.defer();

	fs.readFile(from, function(err, data) {
		if (err) {
			deferred.reject(err);
		} else {
			fs.writeFile(to, data, function(err) {
				if (err) {
					deferred.reject(err);
				} else {
					deferred.resolve();
				}
			});
		}
	});

	return deferred.promise;
}

/**
 * Return an array of corresponding files from a array of glob patterns
 *
 * @param globs {Array}
 * @param bowerFileFolder {string}
 * @param libName {string}
 * @param [depth] {number}
 * @returns {promise}
 */
function arrayOfGlob(globs, bowerFileFolder, libName, depth) {
	var deferred = q.defer();

	var length = globs.length;

	depth = depth || 0;

	if (depth < length) {
		glob(path.join(bowerFileFolder, libName, globs[depth]), function(err, data) {
			if (!err) {
				depth++;

				arrayOfGlob(globs, bowerFileFolder, libName, depth).then(
					function(data2) {
						data = data.concat(data2);

						deferred.resolve(data);
					},
					function(err) {
						deferred.reject(err);
					}
				);
			} else {
				deferred.reject(err);
			}
		});
	} else {
		deferred.resolve([]);
	}

	return deferred.promise;
}

/**
 *
 * @param config {{}}
 * @constructor
 */
function FileObj(config) {
	// Local variables
	config.option = config.option || {min:{}, default:{}};

	this.extToIgnore = config.option.min.ignoreExt || [];
	this.bowerFileFolder = config.bowerFileFolder || ".";
	this.getMin = config.option.min.get || false;
	this.renameMin = config.option.min.renameMin || false;
	this.defMinFolder = config.option.default.minFolder || "";
	this.defFolder = config.option.default.folder || "";
	this.source = config.source;
	this.extensionFolder = config.folder || {};
}

FileObj.prototype = {
	/**
	 * Pass all the library in the config and call enumeratePackages for each one
	 *
	 * @returns {Array}
	 */
	enumerateLibraries: function() {
		var uncleanList = {
				ignore: [],
				move: []
			},
			defer = q.defer(),
			promises = [];

		for (var libs in source) {
			if (source.hasOwnProperty(libs)) {
				var libPart = libs.split("#"),
					libName = libPart[0],
					libFolder = libPart[1] || "",
					currLib = source[libs];

				var promise = this.enumeratePackages(currLib[libs], libName, libFolder);

				promise.then(
					function(data) {
						uncleanList.ignore = uncleanList.ignore.concat(data.ignore);
						uncleanList.move = uncleanList.move.concat(data.move);
					}
				);

				promises.push(promise);
			}
		}

		q.all(promises).then(
			function() {
				// TODO concat all result
				defer.resolve(this.clean(uncleanList));
			},
			function(err) {
				defer.reject(err);
			}
		);

		return defer;
	},

	/**
	 * Pass all the packages in the library and call enumerateFile for each one
	 *
	 * @param pkgs {Array|String}
	 * @param libName {String}
	 * @param libFolder {String}
	 * @returns {Array}
	 */
	enumeratePackages: function(pkgs, libName, libFolder) {
		var uncleanList = [],
			defer = q.defer(),
			promises = [],
			underPromises = [];

		for (var pkg in pkgs) {
			if (pkgs.hasOwnProperty(pkg)) {
				var pkgPart = pkgs.split("#"),
					fileNameAndExt = pkgPart[0] || "*",
					fileFolder = pkgPart[1] || "",
					extName = path.extname(fileNameAndExt),
					fileName = path.basename(fileNameAndExt, extName),
					extension = extName.substr(1);

				if (this.extToIgnore.indexOf(extension) === -1) {
					if (regex.containDoubleAsterisk.test(pkg)) {
						console.error("The \"Globstar\" ** matching wan\"t support by CLEAN-BOWER-INSTALLER." +
						" You have to specify each folder and their destination if you really need it.");
						console.error("Please correct the source: " + libName);
						return [];
					}
				}

				if (!pkgs instanceof Array) {
					pkgs = [pkgs];
				}

				var localCache = {
					fileName: fileName,
					fileFolder: fileFolder,
					pkg: pkg
				};

				var promise = arrayOfGlob(pkgs, this.bowerFileFolder, libName, 0, localCache).then(
					function(pkgList, lc) {
						var underPromise = this.enumerateFile(pkgList, lc.fileName, libFolder, lc.fileFolder, lc.pkg === "!" ? "ignore" : "move");
						underPromise.then(
							function(data) {
								uncleanList.concat(data);
							}
						);

						underPromises.push(underPromise);
					}
				);

				promises.push(promise);
			}
		}

		q.all(promises).then(
			function() {
				q.all(underPromises).then(
					function() {
						defer.resolve(uncleanList);
					},
					function(err) {
						defer.resolve(err);
					}
				);

			},
			function(err) {
				defer.reject(err);
			}
		);
		return defer.promise;
	},

	/**
	 * Pass all the files in the package and return the array of them
	 *
	 * @param files {Array}
	 * @param fileName {string}
	 * @param libFolder {string}
	 * @param fileFolder {string}
	 * @param action {string}
	 * @returns {*}
	 */
	enumerateFile: function(files, fileName, libFolder, fileFolder, action) {
		var length = files.length,
			asteriskName = false,
			f,
			unCleanList = {
				ignore: [],
				move: []
			};

		for (var i = 0; i < length; i++) {
			f = files[i];

			if (regex.containAsterisk.test(fileName)) {
				asteriskName = true;
			}

			// Use the name of the file to replace the * (asterisk) name
			if (asteriskName) {
				fileName = path.basename(f, path.extname(f));
			}

			// Try to find the min file here
			if (this.getMin && !regex.containMin.test(f)) {
				var temp = path.extname(f),
					tempName = f.replace(temp, ".min" + temp);
				if (fs.existsSync(tempName)) {
					f = tempName;
					if (!this.renameMin) {
						fileName += ".min";
					}
				}
			}

			// Test if the link is global or relative
			if (regex.startWithSlash.test(fileFolder)) {
				// The specified file folder is global
				unCleanList[action].push({
					"from": f,
					"to": path.join(this.bowerFileFolder, fileFolder.substr(1)),
					"rename": fileName + path.extname(f)
				});
			} else if (regex.startWithSlash.test(libFolder)) {
				// The specified lib folder is global
				unCleanList[action].push({
					"from": f,
					"to": path.join(this.bowerFileFolder, libFolder.substr(1), fileFolder),
					"rename": fileName + path.extname(f)
				});
			} else {
				var df;
				// Test if redirect the file to the minDefault folder or the default folder
				if (this.getMin && this.defMinFolder !== "") {
					df = (this.defMinFolder);
				} else if (this.defFolder !== "") {
					df = (this.defFolder);
				} else {
					df = "";
				}

				// None of the file or lib specified, then the folder is global
				var extFolder = this.extensionFolder[path.extname(f).substr(1)] || "";
				unCleanList[action].push({
					"from": f,
					"to": path.join(this.bowerFileFolder, df, extFolder, libFolder, fileFolder),
					"rename": fileName + path.extname(f)
				});
			}
		}

		return unCleanList;
	},

	/**
	 * From the list that enter, remove the "to ignore" files
	 *
	 * @param unCleanList {{ignore: Array, move: Array}}
	 * @returns {Array}
	 */
	clean: function(unCleanList) {
		var list = [];

		if (Object.keys(unCleanList).length >= 0) {
			var length = unCleanList.ignore.length,
				length2 = unCleanList.move.length;

			for (var i = 0; i < length; i++) {
				for (var j = 0; j < length2; j++) {
					if (unCleanList.ignore[i].from === unCleanList.move[j].from) {
						unCleanList.move.splice(j, 1);

						length2--;
					}
				}
			}

			list = unCleanList.move;
		}

		return list;
	},

	/**
	 * Allow recursive folder deletion
	 *
	 * @param position {string}
	 * @param [top] {boolean}
	 * @returns {promise}
	 */
	deleteFolder: function(position, top) {
		var deferred = q.defer(),
			promises = [];

		top = top || false;

		fs.exists(position, function(exist) {
			if (exist) {
				fs.readdir(position, function(err, files) {
					if (err) {
						deferred.reject(err);
					} else {
						for (var file in files) {
							if (files.hasOwnProperty(file)) {
								promises.push(this.deleteFile(file, position, top));
							}
						}
					}
				});
			}
		});

		q.all(promises).then(
			function() {
				deferred.resolve();
			},
			function(err) {
				deferred.reject(err);
			}
		);

		return deferred.promise;
	},

	/**
	 * Allow recursive file deletion
	 *
	 * @param file {string}
	 * @param position {string}
	 * @param top {boolean}
	 */
	deleteFile: function(file, position, top) {
		var curPosition = path.join(position, file),
			deferred = q.defer();

		fs.lstat(curPosition, function(err, stat, curPosition) {
			if (err) {
				deferred.reject(err);
			} else {
				if (stat.isDirectory()) {
					this.deleteFolder(curPosition);
				} else {
					fs.unlink(curPosition, function(err) {
						if (err) {
							deferred.reject(err);
						} else if (top) {
							deferred.resolve();
						}
					});
				}
			}
		});

		return deferred.promise;
	},

	/**
	 * Method to delete the bower_components folder
	 *
	 * @returns {promise}
	 */
	deleteBowerComponents: function() {
		var deferred = q.defer();

		this.deleteFolder(path.join(this.bowerFileFolder, "bower_components"), true).then(
			// Pass
			function() {
				deferred.resolve();
			},
			// Fail
			function(err) {
				// Make the error go up
				deferred.reject(err);
			}
		);

		return deferred.promise;
	},

// Public
	/**
	 * Get the list of files covered by the config
	 *
	 * @returns {promise}
	 */
	getList: function() {
		var deferred = q.defer();

		this.enumerateLibraries().then(
			function(data) {
				deferred.resolve(data);
			},
			function(err) {
				deferred.reject(err);
			}
		);

		return deferred.promise;
	},

	/**
	 * Execute the copy of the listed files
	 *
	 * @returns {promise}
	 */
	run: function() {
		var list = this.getList(),
			length = list.length,
			deferred = q.defer(),
			promises = [];

		for (var i = 0; i < length; i++) {
			promises.push(fileCopy(list[i].from, list[i].to));
		}

		q.all(promises).then(
			function(data) {
				deferred.resolve(data);
			},
			function(err) {
				deferred.reject(err);
			}
		);

		return deferred.promise;
	},

	/**
	 * Execute the copy of the listed files and delete the bower_components folder after
	 *
	 * @returns {promise}
	 */
	runAndRemove: function() {
		var deferred = q.defer(),
			pointer = this;

		this.run().then(
			function(data) {

				pointer.deleteBowerComponents().then(
					function() {
						deferred.resolve(data);
					},
					function(err) {
						deferred.reject(err);
					}
				);
			},
			function(err) {
				pointer.deleteBowerComponents().finally(
					function() {
						deferred.reject(err);
					}
				);
			}
		);

		return deferred.promise;
	}
};

/**
 * Main method to move the files from the bower_components folder to their destination listed in the cInstall.source
 *
 * @param config {{}}
 * @returns {promise}
 */
function moveFiles(config) {
	var deferred = q.defer();

	// Call the listing object
	var list = new FileObj(config);
	list.run().then(
		function(data) {
			deferred.resolve(data);
		},
		function(err) {
			deferred.reject(err);
		}
	);

	return deferred.promise;
}

/**
 * Main method to move the files from the bower_components folder to their destination listed in the cInstall.source
 * and after, delete the bower_components folder.
 *
 * @param config
 * @returns {promise}
 */
function moveFilesAndRemove(config) {
	var deferred = q.defer();

	// Call the listing object
	var list = new FileObj(config);
	list.runAndRemove().then(
		function(data) {
			deferred.resolve(data);
		},
		function(err) {
			deferred.reject(err);
		}
	);

	return deferred.promise;
}

module.exports = {
	moveFiles: moveFiles,
	moveFilesAdnRemove: moveFilesAndRemove
};


// Test !!!!!!!
var testConfig = {
	folder: {
		js: 'js/vendor/',
		less: 'css/less/',
		'otf, eot, svg, ttf, woff': 'fonts/'
	},
	source: {
		angular: {'angular.js': 'angular.js'},
		'angular-bootstrap': {
			'ui-bootstrap.js': 'ui-bootstrap.js',
			'ui-bootstrap-tpls.js': 'ui-bootstrap-tpls.js'
		},
		'angular-sanitize': {'angular-sanitize.js': 'angular-sanitize.js'},
		'angular-translate': {'angular-translate.js': 'angular-translate.js'},
		bootstrap: {
			'glyphicons-halflings-regular.*': 'dist/fonts/*',
			'bootstrap.js': 'dist/js/bootstrap.js',
			'*.less#bootstrap': 'less/*.less',
			'*.less#bootstrap/mixins': 'less/mixins/*.less'
		},
		'bootstrap-select': {
			'*.less#bootstrapSelect': 'less/*.less',
			'bootstrap-select.js': 'dist/js/bootstrap-select.js'
		},
		fontawesome: {
			'FontAwesome.otf': 'fonts/FontAwesome.otf',
			'fontawesome-webfont.*': 'fonts/fontawesome-webfont.*',
			'*.less#fontawesome': 'less/*.less'
		},
		jquery: {'jquery.js': 'dist/jquery.js'},
		'jquery.scrollTo': {'jquery.scrollTo.js': 'jquery.scrollTo.js'},
		'ui-router': {'angular-ui-router.js': 'release/angular-ui-router.js'},
		'validator-js': {'validator.js': 'validator.js'}
	}
};

/* Local temp test section */
var testIT = new FileObj(testConfig);

arrayOfGlob(["lib/*","bin/*","node_modules/**/package.json"], __dirname, "..").then(
	function(data) {
		console.warn("-------------");
		console.dir(data);
		console.warn("-------------");
		console.warn(data.length);
	},
	function (err) {
		console.warn(err);
	}
);
