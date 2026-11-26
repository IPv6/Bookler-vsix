const vscode = require('vscode');
const path = require('path');

// ??? теги: учитывать для тегирования все что ДО ":" и ";" и "|"
// - а "/" и "." ок
// vscode: "onLanguage:json"
// или без разницы?

function isString(value) {
	return typeof value === 'string' || value instanceof String;
}

function isNumber(value) {
	return typeof value === 'number';
}

function isArray(value) {
	// if (Object.prototype.toString.call(results) === '[object Array]') {
	return Array.isArray(value);
}

function safeKeys(obj){
	if(obj == null){
		return [];
	}
	return Object.keys(obj);
}

function safeLen(obj){
	if(obj == null){
		return 0;
	}
	if(isArray(obj)){
		return obj.length
	}
	return Object.keys(obj).length;
}

function safeFloat(text){
    // IMPORTANT: Any non-digital postfix removed
    if(text != null && typeof(text) === "number"){
        // Already float
        return text;
    }
    if(text == null){
        return 0.0;
    }
    text = (""+text).trim();
    text = text.replace(/[^\d.-]/g, '');
    if(text.length == 0){
        return 0.0;
    }
    return parseFloat(text);
}

function safeInt(text){
    // IMPORTANT: Any non-digital postfix removed
    if(text != null && typeof(text) === "number"){
        // Already float
        return Math.floor(text);
    }
    if(text == null || text.length == 0){
        return 0;
    }
    text = text.trim();
    text = text.replace(/[^\d.-]/g, '');
    if(text.length == 0){
        return 0;
    }
    return parseInt(text);
}

function safeBool(text){
	if(text == null){
		return false;
	}
	if (typeof(text) === "boolean") {
		return text;
	}
	if(typeof(text) === "number"){
		if(text >= 1.0){
			return true;
		}
		return false;
	}
	if( (""+text).toLowerCase() == "true"){
		return true;
	}
	return false;
}

function safeStr(text, maxLength = -1, doTrim = false){
	if(text == null){
		return "";
	}
	if(!isString(text)){
		text = ""+text;
	}
	if(doTrim){
		text = text.trim();
	}
	if(maxLength > 3){
		if(text.length > maxLength){
			text = text.substring(0, maxLength-3)+"...";
		}
	}
	return text;
}

function strReplaceAll(str, what, rto){
	if(str == null || str.length == 0){
		return "";
	}
	// let spli = str.split(what);
	// let joi = spli.join(rto);
	// return joi
	return str.replaceAll(what, rto);
}

function pathToPosix(filepath){
	if(!filepath || filepath.length == 0){
		return "";
	}
	// For paths, for globs
	let filepathParsed = filepath;
	if(filepathParsed.indexOf("\\") >= 0){
		filepathParsed = filepath.split(`\\`).join(`/`);
	}
	filepathParsed = path.posix.normalize(filepathParsed);
	return filepathParsed;
}

function strIndexOfAll(str, substr){
	let result = [];
	if(safeLen(str) == 0 || safeLen(substr) == 0){
		return result;
	}
	let idx = str.indexOf(substr)
	while (idx !== -1) {
	  result.push(idx);
	  idx = str.indexOf(substr, idx+1);
	}
	return result;
}

function strIndexOfAllX(str, substr){
	if(safeLen(str) == 0){
		return [];
	}
	if(substr && (substr.indexOf("*") >= 0 ||substr.indexOf("?") >= 0 )){
		let result = [];
		// Wildcards present, converting to RegEx
		let w = substr.replace(/[.+^${}()|[\]\\]/g, '\\$&'); // regex escape
		w = w.replace(/\*/g,'.*').replace(/\?/g,'.');
		const w_re = new RegExp(w,'g');
		while ((w_res = w_re.exec(str)) !== null) {
			result.push(w_res.index);
		}
		//console.log("strIndexOfAllX", str, substr, result);
		return result;
	}
	return strIndexOfAll(str, substr);
}

function strIndexOfAnyRight(str, pos, listOfStops)
{
	if(!str || pos >= str.length || safeLen(listOfStops) == 0){
		return {idx:-1, stop: ""};
	}
	let res = {idx:-1, stop: ""};
	for(stp of listOfStops){
		let idx = str.indexOf(stp, pos);
		if(idx >= 0){
			if(res.idx < 0 || idx < res.idx){
				res.idx = idx;
				res.stop = stp;
			}
		}
	}
	return res;
}

function strIndexOfAnyLeft(str, pos, listOfStops)
{
	if(!str || pos < 0 || safeLen(listOfStops) == 0){
		return {idx:-1, stop: ""};
	}
	let res = {idx:-1, stop: ""};
	for(stp of listOfStops){
		let idxes = strIndexOfAll(str, stp);
		for(idx of idxes){
			if(idx >= 0 && idx <= pos){
				if(res.idx < 0 || idx > res.idx){
					res.idx = idx;
					res.stop = stp;
				}
			}
		}
	}
	return res;
}

module.exports = {
	strReplaceAll,
	strIndexOfAll,
	strIndexOfAllX,
	pathToPosix,
	isString,
	isNumber,
	isArray,
	safeKeys,
	safeLen,
	safeFloat,
	safeInt,
	safeBool,
	safeStr,
	strIndexOfAnyRight,
	strIndexOfAnyLeft
}