const vscode = require('vscode');
const fs = require('fs-extra'); // https://www.npmjs.com/package/fs-extra
const fs_glob = require('fast-glob'); // https://www.npmjs.com/package/fast-glob
const path = require('path');// https://nodejs.org/docs/latest/api/path.html
const utils = require('./utils.js');
const kWikiLinksFencing = ["[[","]]"];
const kTagContextFencing = ":";
const kOptPrefFile = "file:";
const kOptPrefCtx = "context:";
const kOptPrefNegate = "-";
const kOptSkipNotHere = "file:this!";
const kOptSkipNoContext = "context:amust!";
//const kOptContextSortAlways = "context_sort_always";
const kTagWhitespaceFencing = ["\n","\t"," "];
const kTagWhitespaceFencingAsStr = kTagWhitespaceFencing.join();

let g_cache = {
	files: {}
};

function resetCaches() {
	g_cache["files"] = {};
}

// function getStats() {
// 	let stats = {};
// 	stats["summary"] = "Files in cache:"+Object.keys(g_cache["files"]).length;
// 	return stats;
// }

function getConfig(forFile) {
	const booklerConfigs = vscode.workspace.getConfiguration('bookler');
	// TBD: if(forFile){... copy && add }
	return booklerConfigs;
}

function getConfigArray(confname, defl, forFile) {
	const booklerConfigs = getConfig(forFile);
	let val = booklerConfigs[confname];
	if(!val){
		if(!defl){
			defl = []
		}
		val = defl;
	}
	return val
}

function getConfigString(confname, defl, forFile) {
	const booklerConfigs = getConfig(forFile);
	let val = booklerConfigs[confname];
	if(!val){
		if(!defl){
			defl = "";
		}
		val = defl;
	}
	return val
}

function getConfigNumber(confname, defl, forFile) {
	const booklerConfigs = getConfig(forFile);
	let val = booklerConfigs[confname];
	if(!val){
		if(!defl){
			defl = 0;
		}
		val = defl;
	}
	return val
}

function getBookletRoot(file_path) {
	// ??? Add caching. Not for now
	file_path = utils.pathToPosix(file_path);
	if(file_path.length == 0 || !fs.pathExistsSync(file_path)){
		return null;
	}
	const current_folder = path.posix.dirname(file_path);
	// Default result, without specific booklet TOCs
	let result = {
		root_file: file_path,
		root_folders: [current_folder],
		booklet_file: "none"
	}
	// console.log("- getBookletRoot: ini", file_path, current_folder);
	// Looking for bookletRootFiles
	let bookletRootFile = getConfigString('bookletRootFiles')
	// Looking for bookletRootFile in each folder
	var dirs = current_folder.split("/");
	for(var k = dirs.length; k >= 1; k--){
		var testfoldr = dirs.slice(0,k).join("/") + "/";
		var testpath = testfoldr + bookletRootFile;
		// console.log("- getBookletRoot: test",testpath, fs.pathExistsSync(testpath));
		if(fs.pathExistsSync(testpath)){
			result = {
				root_file: testpath,
				root_folders: [testfoldr],
				booklet_file: testpath
			};
			break;
		}
	}
	return result;
}

function getBookletFiles(root_folders){
	let all_files = [];
	const pos_pat = getConfigArray("collectFilesByName");
	const neg_pat = getConfigArray("ignoreFilesByName");
	// const neg_size = getConfigNumber("ignoreFilesBySize"); // NOT used, easier to check on file read
	for(root_folder of root_folders){
		let filesList = fs_glob.sync(pos_pat,{
			cwd: root_folder, deep: 5, ignore: neg_pat, suppressErrors: true, 
			absolute: true, unique: false, globstar: true,
			dot: false, onlyFiles: true, // markDirectories: true, 
		});
		// all_files = all_files.concat(filesList);
		all_files = [...new Set([...all_files ,...filesList])];
	}
	all_files.sort();
	return all_files;
}

function resetFileCache(file_path){
	file_path = utils.pathToPosix(file_path);
	g_cache["files"][file_path] = null;
}
function getFileCached(file_path, force){
	file_path = utils.pathToPosix(file_path);
	if(force){
		g_cache["files"][file_path] = null;
	}
	const file_stat = fs.statSync(file_path);
	const neg_size = getConfigNumber("ignoreFilesBySize");
	if(file_stat.size > neg_size){
		return null;
	}

	// Compare time
	let ftime = 0;
	if(file_stat.ctime){
		ftime = Math.max(ftime, file_stat.ctime.getTime());
	}
	if(file_stat.mtime){
		ftime = Math.max(ftime, file_stat.mtime.getTime());
	}
	if(g_cache["files"][file_path] && g_cache["files"][file_path]["ftime"] < ftime){
		console.log("File updated, flushing log for",file_path);
		g_cache["files"][file_path] = null;
	}
	if(!g_cache["files"][file_path]){
		// Reading file in utf8. posix mode, "/n" only (forced linux-style)
		let content_raw = fs.readFileSync(file_path, {encoding: "utf-8"});
		// console.log("- reading file", file_path, content.indexOf("\r"));
		content = utils.strReplaceAll(content_raw, "\r", "");
		newlines = utils.strIndexOfAll(content, "\n");
		let is_win = false;
		if(content_raw != content){
			is_win = true;
		}
		g_cache["files"][file_path] = {
			ftime: ftime,
			is_win: is_win,
			posix_utf8: content,
			idx_newlines: newlines
		}
	}
	return g_cache["files"][file_path];
}

function expandTagsWithPrefixes(listOfTags) {
	let listOfTags_prefixed = [];
	let tag_prefixes = getConfigArray("contentTagPrefix");
	for(pref of tag_prefixes){
		let tag_prefixed = [];
		for(linkText of listOfTags){
			if(linkText.indexOf(pref) == 0){
				// Already prefixed
				tag_prefixed = [linkText];
				break
			}else{
				tag_prefixed.push(pref+linkText);
			}
		}
		listOfTags_prefixed = listOfTags_prefixed.concat(tag_prefixed);
	}
	return listOfTags_prefixed;
}

function calcLinkQuery(linkText) {
	let forwardTags = [];
	let negativeTags = [];
	let contextGroups = [];
	let fileGroups = [];
	let generalFlags = [];
	linkText = utils.strReplaceAll(linkText,"\t",",")
	linkText = utils.strReplaceAll(linkText," ",",")
	if(linkText.indexOf(",") > 0 || linkText.indexOf(":") > 0){
		let query = linkText.split(",");
		for(qi of query){
			if(utils.safeLen(qi) == 0){
				continue;
			}
			if(qi == kOptSkipNotHere){
				generalFlags.push(kOptSkipNotHere);
				continue;
			}
			if(qi == kOptSkipNoContext){
				generalFlags.push(kOptSkipNoContext);
				contextGroups.push(kOptSkipNoContext);// Just a fake value to trigger context sort
				continue;
			}
			if(qi.startsWith(kOptPrefNegate)){
				negativeTags.push(qi.substring(kOptPrefNegate.length));
				continue;
			}
			if(qi.startsWith(kOptPrefCtx)){
				contextGroups.push(qi.substring(kOptPrefCtx.length));
				continue;
			}
			if(qi.startsWith(kOptPrefFile)){
				fileGroups.push(qi.substring(kOptPrefFile.length));
				continue;
			}
			forwardTags.push(qi);
		}
		// linkText_base = query[0];
		// forwardTags = linkText_base.split(",");
		// for(var qi=1;qi<query.length;qi++){
		// 	var item = query[qi].split("=");
		// 	if(item.length >= 2 && item[0] == "ignore"){
		// 		negativeTags = item[1].split(",");
		// 	}
		// 	if(item.length >= 2 && item[0] == "context"){
		// 		contextGroups = item[1].split(",");
		// 	}
		// 	if(item.length >= 2 && item[0] == "flags"){
		// 		generalFlags = item[1].split(",");
		// 	}
		// }
	}else{
		forwardTags = [linkText];
	}
	let parse_results = {
		forwardTags: forwardTags,
		negativeTags: negativeTags,
		fileGroups: fileGroups,
		contextGroups: contextGroups,
		generalFlags: generalFlags
	}
	// console.log("- parse_results", parse_results);
	return parse_results;
}

function findBookletLinkLocations(startFile, listOfTagsAny, checkPath, checkContent) {
	const booklet_root = getBookletRoot(startFile);
	if(!booklet_root){
		console.log("Bookler: root file not found for path:", startFile);
		return null;
	}
	let listOfTags_asis = null;
	let listOfTags_prefixed = null;
	if(utils.isString(listOfTagsAny)){
		let {forwardTags} = calcLinkQuery(listOfTagsAny);
		listOfTags_asis = forwardTags;
		listOfTags_prefixed = expandTagsWithPrefixes(forwardTags);
	}else if(utils.isArray(listOfTagsAny)){
		listOfTags_asis = listOfTagsAny;
		listOfTags_prefixed = listOfTagsAny;
	}
	if(listOfTags_asis == null){
		return null;
	}
	// Checking term inclusions
	const result_byfilename = [];
	const result_bytag = [];
	const booklet_files = getBookletFiles(booklet_root.root_folders);
	// console.log("booklet_files", booklet_files);
	// skipping booklet root, skipping self-location
	for(boo_file_path of booklet_files){
		if(checkPath){
			for(linkText of listOfTags_asis){
				if(utils.strIndexOfAllX(boo_file_path, linkText).length > 0){
					result_byfilename.push( [boo_file_path, 0] );
				}
			}
			// Checking relative paths if link text is relative
			let startFile_path = utils.pathToPosix(startFile);
			let startFile_folder = path.posix.dirname(startFile_path);
			root_folders = [...booklet_root.root_folders];
			root_folders.push(startFile_folder);
			for(fld of root_folders){
				for(linkText of listOfTags_asis){
					let testpath = utils.pathToPosix(fld+"/"+linkText);
					if(fs.pathExistsSync(testpath)){
						result_byfilename.push( [testpath, 0] );
					}
				}
			}
		}
		if(checkContent){
			let file_dat = getFileCached(boo_file_path);
			if(!file_dat){
				continue;
			}
			let boo_file_content = file_dat.posix_utf8;
			let all_newlines = file_dat.idx_newlines;
			for(prefixed of listOfTags_prefixed){
				let all_idx = utils.strIndexOfAllX(boo_file_content, prefixed);
				for(idx of all_idx){
					// counting newlines up to found index
					let line = 0;
					for(nl_idx of all_newlines){
						if(nl_idx < idx){
							line = line+1;
						}else{
							break;
						}
					}
					result_byfilename.push( [boo_file_path, line] );
				}
			}
		}
	}
	result_byfilename.sort(function(a, b){
		if(a[0] < b[0]) { return -1; }
		if(a[0] > b[0]) { return 1; }
		return 0;
	});
	result_bytag.sort(function(a, b){
		if(a[0] < b[0]) { return -1; }
		if(a[0] > b[0]) { return 1; }
		return 0;
	});
	let result_total = result_byfilename.concat(result_bytag);
	return result_total;
}

function calcTextBlocks(text_in, idx_newlines){
	// expect text_in to be "\n"-formatted
	// expect idx_newlines to be generated from text_in
	// Return blocks positions BETWEEN \n...\n
	if(!text_in){
		return null;
	}
	if(!idx_newlines){
		idx_newlines = utils.strIndexOfAll(text_in, "\n");
	}else{
		// Need a copy for mangling
		idx_newlines = idx_newlines.slice();
	}
	let blocks_data = [];
	if(idx_newlines.length == 0){
		// Single block
		let block_dat = {
			pos_from: 0,
			pos_to: text_in.length-1,
		}
		blocks_data.push(block_dat);
		return blocks_data;
	}
	if(idx_newlines[0] != 0){
		// "fake first newline"
		idx_newlines.unshift(0);
	}
	if(idx_newlines[idx_newlines.length-1] != text_in.length-1){
		idx_newlines.push(text_in.length-1);
	}
	// Extra newline at end for finishing blocks
	// "fake last newline"
	idx_newlines.push(text_in.length-1);
	// считать непустые между i,i+1
	// если ненуль - обновлять индекс конца блока (до ньюлайна)
	// если нуль - добавлять блок если не пустой, обновлять начало блока (после ньюлайна)
	let block_start = -1;
	let block_end = block_start;
	for(var i=0;i<idx_newlines.length-1;i++){
		// Any non-empty between this line and next one?
		let isNonEmptyLine = false;
		for(var pp=idx_newlines[i]; pp<idx_newlines[i+1]; pp++){
			let pp_char = text_in[pp];
			if(kTagWhitespaceFencingAsStr.indexOf(pp_char) < 0){
				// Non-empty char
				isNonEmptyLine = true;
				break;
			}
		}
		if(isNonEmptyLine){
			block_end = idx_newlines[i+1];
			if(text_in[block_end] == "\n"){
				// Problem with "fake last newline"...
				block_end = block_end-1;
			}
			if(block_start < 0){
				block_start = idx_newlines[i];
				if(text_in[block_start] == "\n"){
					// Problem with "fake first newline"...
					block_start = block_start+1;
				}
			}
		}else{
			if(block_start >= 0 && block_end > block_start){
				// Adding block
				let block_dat = {
					pos_from: block_start,
					pos_to: block_end,
				}
				blocks_data.push(block_dat);
			}
			block_start = -1;
		}
	}
	return blocks_data;
}

module.exports = {
	getConfigArray,
	getConfigString,
	getConfigNumber,
	resetCaches,
	getBookletRoot,
	getBookletFiles,
	getFileCached,
	resetFileCache,
	findBookletLinkLocations,
	expandTagsWithPrefixes,
	calcLinkQuery,
	calcTextBlocks,
	kWikiLinksFencing,
	kTagContextFencing,
	kOptSkipNotHere,
	kOptSkipNoContext,
	// kOptContextSortAlwways,
	kTagWhitespaceFencing,
}