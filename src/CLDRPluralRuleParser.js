/**
 * cldrpluralparser.js
 * A parser engine for CLDR plural rules.
 *
 * Copyright 2012 GPLV3+, Santhosh Thottingal
 *
 * @author Santhosh Thottingal <santhosh.thottingal@gmail.com>
 */

/**
 * @param rule
 * @param number
 * @return true|false|null
 */
function pluralRuleParser(rule, number) {

	// Indicates current position in the rule as we parse through it.
	// Shared among all parsing functions below.
	var pos = 0;

	var whitespace = makeRegexParser(/^\s+/);
	var digits = makeRegexParser(/^\d+/);

	var _n_ = makeStringParser('n');
	var _is_ = makeStringParser('is');
	var _mod_ = makeStringParser('mod');
	var _not_ = makeStringParser('not');
	var _in_ = makeStringParser('in');
	var _within_ = makeStringParser('within');
	var _range_ = makeStringParser('..');
	var _or_ = makeStringParser('or');
	var _and_ = makeStringParser('and');

	function debug() {
		/**/ console.log.apply(console, arguments);
	}

	debug('pluralRuleParser', rule, number);

	// Try parsers until one works, if none work return null
	function choice(parserSyntax) {
		return function () {
			for (var i = 0; i < parserSyntax.length; i++) {
				var result = parserSyntax[i]();
				if (result !== null) {
					return result;
				}
			}
			return null;
		};
	}

	// Try several parserSyntax-es in a row.
	// All must succeed; otherwise, return null.
	// This is the only eager one.
	function sequence(parserSyntax) {
		var originalPos = pos;
		var result = [];
		for (var i = 0; i < parserSyntax.length; i++) {
			var res = parserSyntax[i]();
			if (res === null) {
				pos = originalPos;
				return null;
			}
			result.push(res);
		}
		return result;
	}

	// Run the same parser over and over until it fails.
	// Must succeed a minimum of n times; otherwise, return null.
	function nOrMore(n, p) {
		return function () {
			var originalPos = pos;
			var result = [];
			var parsed = p();
			while (parsed !== null) {
				result.push(parsed);
				parsed = p();
			}
			if (result.length < n) {
				pos = originalPos;
				return null;
			}
			return result;
		};
	}

	// There is a general pattern -- parse a thing, if that worked, apply transform, otherwise return null.
	// But using this as a combinator seems to cause problems when combined with nOrMore().
	// May be some scoping issue.
	function transform(p, fn) {
		return function () {
			var result = p();
			return result === null ? null : fn(result);
		};
	}

	// Helpers -- just make parserSyntax out of simpler JS builtin types

	function makeStringParser(s) {
		var len = s.length;
		return function () {
			var result = null;
			if (rule.substr(pos, len) === s) {
				result = s;
				pos += len;
			}
			return result;
		};
	}

	function makeRegexParser(regex) {
		return function () {
			var matches = rule.substr(pos).match(regex);
			if (matches === null) {
				return null;
			}
			pos += matches[0].length;
			return matches[0];
		};
	}

	function n() {
		var result = _n_();
		if (result === null) {
			debug(" -- failed n");
			return result;
		}
		result = parseInt(number, 10);
		debug(" -- passed n ", result);
		return result;
	}

	var expression = choice([mod, n]);

	function mod() {
		var result = sequence([n, whitespace, _mod_, whitespace, digits]);
		if (result === null) {
			debug(" -- failed mod");
			return null;
		}
		debug(" -- passed mod");
		return parseInt(result[0], 10) % parseInt(result[4], 10);
	}

	function not() {
		var result = sequence([whitespace, _not_]);
		if (result === null) {
			debug(" -- failed not");
			return null;
		} else {
			return result[1];
		}
	}

	function is() {
		var result = sequence([expression, whitespace, _is_, nOrMore(0, not), whitespace, digits]);
		if (result !== null) {
			debug(" -- passed is");
			if (result[3] === 'not') {
				return result[0] !== parseInt(result[5], 10);
			} else {
				return result[0] === parseInt(result[5], 10);
			}
		}
		debug(" -- failed is");
		return null;
	}

	function range() {
		var result = sequence([digits, _range_, digits]);
		if (result !== null) {
			debug(" -- passed range");
			var array = [];
			var left = parseInt(result[0], 10);
			var right = parseInt(result[2], 10);
			for ( i = left; i <= right; i++) {
				array.push(i);
			}
			return array;
		}
		debug(" -- failed range");
		return null;
	}

	function _in() {
		var result = sequence([expression, nOrMore(0, not), whitespace, _in_, whitespace, range]);
		if (result !== null) {
			debug(" -- passed _in");
			var range_list = result[5];
			for (var i = 0; i < range_list.length; i++) {
				if (range_list[i] === result[0]) {
					return (result[1] !== 'not');
				}
			}
			return (result[1] === 'not');
		}
		debug(" -- failed _in");
		return null;
	}

	function within() {
		var result = sequence([expression, whitespace, _within_, whitespace, range]);
		if (result !== null) {
			debug(" -- passed within");
			var range_list = result[4];
			for (var i = 0; i < range_list.length; i++) {
				if (range_list[i] === result[0]) {
					return true;
				}
			}
		}
		debug(" -- failed within");
		return null;
	}

	var relation = choice([is, _in, within]);

	function and() {
		var result = sequence([relation, whitespace, _and_, whitespace, condition]);
		if (result) {
			debug(" -- passed and");
			return result[0] && result[4];
		}
		debug(" -- failed and");
		return null;
	}

	function or() {
		var result = sequence([relation, whitespace, _or_, whitespace, condition]);
		if (result) {
			debug(" -- passed or");
			return result[0] || result[4];
		}
		debug(" -- failed or");
		return null;
	}

	var condition = choice([and, or, relation]);

	function start() {
		var result = condition();
		return result;
	}

	// Everything above this point is supposed to be stateless/static, but
	// I am deferring the work of turning it into prototypes & objects.
	// It's quite fast enough
	// ---
	// finally let's do some actual work...

	var result = start();

	/*
	 * For success, the pos must have gotten to the end of the rule
	 * and returned a non-null.
	 * n.b. This is part of language infrastructure, so we do not throw an internationalizable message.
	 */
	if (result === null || pos !== rule.length) {
		// throw new Error("Parse error at position " + pos.toString() + " in input: " + rule + " result is " + result);
	}

	return result;
}

/* For module loaders, e.g. NodeJS, NPM */
if (typeof module !== 'undefined' && module.exports) {
	module.exports = pluralRuleParser;
}