// Copyright (c) 2014 Patrick Dubroy <pdubroy@gmail.com>
// This software is distributed under the terms of the MIT License.

var extend = require('util-extend');

// An internal object that can be returned from a visitor function to
// prevent a top-down walk from walking subtrees of a node.
var stopRecursion = {};

// An internal object that can be returned from a visitor function to
// cause the walk to immediately stop.
var stopWalk = {};

var notTreeError = 'Not a tree: same object found in two different branches';
var hasOwnProp = Object.prototype.hasOwnProperty;

// Helpers
// -------

// Replacement for a few functions from Underscore that we need.
var _ = {
  any: function(obj, predicate) {
    if (obj === null || !obj) return false;
    var keys = obj.length !== +obj.length && Object.keys(obj),
        length = (keys || obj).length,
        index, currentKey;
    for (index = 0; index < length; index++) {
      currentKey = keys ? keys[index] : index;
      if (predicate(obj[currentKey], currentKey, obj)) return true;
    }
    return false;
  },
  isElement: function(obj) {
    return !!(obj && obj.nodeType === 1);
  },
  isObject: function(obj) {
    var type = typeof obj;
    return type === 'function' || type === 'object' && !!obj;
  }
};

// Implements the default traversal strategy: if `obj` is a DOM node, walk
// its DOM children; otherwise, walk all the objects it references.
function defaultTraversal(obj) {
  return _.isElement(obj) ? obj.children : obj;
}

// Walk the tree recursively beginning with `root`, calling `beforeFunc`
// before visiting an objects descendents, and `afterFunc` afterwards.
// If `collectResults` is true, the last argument to `afterFunc` will be a
// collection of the results of walking the node's subtrees.
function walkImpl(root, traversalStrategy, beforeFunc, afterFunc, context, collectResults) {
  var visited = [];
  return (function _walk(value, key, parent) {
    // Keep track of objects that have been visited, and throw an exception
    // when trying to visit the same object twice.
    if (_.isObject(value)) {
      if (visited.indexOf(value) >= 0) throw new TypeError(notTreeError);
      visited.push(value);
    }

    if (beforeFunc) {
      var result = beforeFunc.call(context, value, key, parent);
      if (result === stopWalk) return stopWalk;
      if (result === stopRecursion) return;
    }

    var subResults;
    var target = traversalStrategy(value);
    if (_.isObject(target)) {
      // Collect results from subtrees in the same shape as the target.
      if (collectResults) subResults = Array.isArray(target) ? [] : {};

      var stop = _.any(target, function(obj, key) {
        var result = _walk(obj, key, value);
        if (result === stopWalk) return true;
        if (subResults) subResults[key] = result;
      });
      if (stop) return stopWalk;
    }
    if (afterFunc) return afterFunc.call(context, value, key, parent, subResults);
  })(root);
}

// Internal helper providing the implementation for `pluck` and `pluckRec`.
function pluck(obj, propertyName, recursive) {
  var results = [];
  this.preorder(obj, function(value, key) {
    if (!recursive && key == propertyName)
      return stopRecursion;
    if (hasOwnProp.call(value, propertyName))
      results[results.length] = value[propertyName];
  });
  return results;
}

// Returns an object containing the walk functions. If `traversalStrategy`
// is specified, it is a function determining how objects should be
// traversed. Given an object, it returns the object to be recursively
// walked. The default strategy is equivalent to `_.identity` for regular
// objects, and for DOM nodes it returns the node's DOM children.
function Walker(traversalStrategy) {
  if (!(this instanceof Walker))
    return new Walker(traversalStrategy);
  this._traversalStrategy = traversalStrategy || defaultTraversal;
}

extend(Walker.prototype, {
  // Performs a preorder traversal of `obj` and returns the first value
  // which passes a truth test.
  find: function(obj, visitor, context) {
    var result;
    this.preorder(obj, function(value, key, parent) {
      if (visitor.call(context, value, key, parent)) {
        result = value;
        return stopWalk;
      }
    }, context);
    return result;
  },

  // Recursively traverses `obj` and returns all the elements that pass a
  // truth test. `strategy` is the traversal function to use, e.g. `preorder`
  // or `postorder`.
  filter: function(obj, strategy, visitor, context) {
    var results = [];
    if (obj === null) return results;
    strategy(obj, function(value, key, parent) {
      if (visitor.call(context, value, key, parent)) results.push(value);
    }, null, this._traversalStrategy);
    return results;
  },

  // Recursively traverses `obj` and returns all the elements for which a
  // truth test fails.
  reject: function(obj, strategy, visitor, context) {
    return this.filter(obj, strategy, function(value, key, parent) {
      return !visitor.call(context, value, key, parent);
    });
  },

  // Produces a new array of values by recursively traversing `obj` and
  // mapping each value through the transformation function `visitor`.
  // `strategy` is the traversal function to use, e.g. `preorder` or
  // `postorder`.
  map: function(obj, strategy, visitor, context) {
    var results = [];
    strategy(obj, function(value, key, parent) {
      results[results.length] = visitor.call(context, value, key, parent);
    }, null, this._traversalStrategy);
    return results;
  },

  // Return the value of properties named `propertyName` reachable from the
  // tree rooted at `obj`. Results are not recursively searched; use
  // `pluckRec` for that.
  pluck: function(obj, propertyName) {
    return pluck.call(this, obj, propertyName, false);
  },

  // Version of `pluck` which recursively searches results for nested objects
  // with a property named `propertyName`.
  pluckRec: function(obj, propertyName) {
    return pluck.call(this, obj, propertyName, true);
  },

  // Recursively traverses `obj` in a depth-first fashion, invoking the
  // `visitor` function for each object only after traversing its children.
  // `traversalStrategy` is intended for internal callers, and is not part
  // of the public API.
  postorder: function(obj, visitor, context, traversalStrategy) {
    traversalStrategy = traversalStrategy || this._traversalStrategy;
    walkImpl(obj, traversalStrategy, null, visitor, context);
  },

  // Recursively traverses `obj` in a depth-first fashion, invoking the
  // `visitor` function for each object before traversing its children.
  // `traversalStrategy` is intended for internal callers, and is not part
  // of the public API.
  preorder: function(obj, visitor, context, traversalStrategy) {
    traversalStrategy = traversalStrategy || this._traversalStrategy;
    walkImpl(obj, traversalStrategy, visitor, null, context);
  },

  // Builds up a single value by doing a post-order traversal of `obj` and
  // calling the `visitor` function on each object in the tree. For leaf
  // objects, the `memo` argument to `visitor` is the value of the `leafMemo`
  // argument to `reduce`. For non-leaf objects, `memo` is a collection of
  // the results of calling `reduce` on the object's children.
  reduce: function(obj, visitor, leafMemo, context) {
    var reducer = function(value, key, parent, subResults) {
      return visitor(subResults || leafMemo, value, key, parent);
    };
    return walkImpl(obj, this._traversalStrategy, null, reducer, context, true);
  }
});

var WalkerProto = Walker.prototype;

// Set up a few convenient aliases.
WalkerProto.each = WalkerProto.preorder;
WalkerProto.collect = WalkerProto.map;
WalkerProto.detect = WalkerProto.find;
WalkerProto.select = WalkerProto.filter;

// Export the walker constructor, but make it behave like an instance.
Walker._traversalStrategy = defaultTraversal;
module.exports = extend(Walker, WalkerProto);
