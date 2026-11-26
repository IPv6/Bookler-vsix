// ??? не заморачиваться со строками - только если будут проблемы, с блоками проще
// - а просто делать документ в список блоков с разделителями. в блоке хеш, нумерация на уникальность
// - восстанавливать документ по списку блоков целиком, с заменой или допиской если не на что
// - переводы в сурсе сохранять, приводить к нему блоки, но хеши все считать в linux-style
// ??? нужно хранить хеш ОРИГИНАЛА. и при ресейвах всегда использовать оригинал
// - иначе если добавить в блок другие блоки с переносами, то при пересчете хеши совпадать уже не будут
// - или ругаться
// ???: блоки надо хешировать даже для line-based?
// - и при сохранении ругаться если были паралельные изменения
// ???: нужна возможность руками удалить хеш чтобы сохранить anyway?

const vscode = require('vscode');
const os = require("os");
const fs = require('fs-extra');
const path = require('path');
const boo_base = require('./boo_base.js');
const utils = require('./utils.js');
let execution_lock = 0;

class BooklerNotebookSerializer {
	async deserializeNotebook(content,_token) {
		var contents = new TextDecoder().decode(content);
		let nb_content = [];
		try {
			nb_content = JSON.parse(contents);
		} catch {
			nb_content = [];
		}
		let cells = [];
		for(var item of nb_content){
			let cell = new vscode.NotebookCellData(item.kind, item.value, "text");
			cell.metadata = item.metadata;
			cells.push(cell);
		};
		return new vscode.NotebookData(cells);
	}
	
	async serializeNotebook(data, _token) {
		let nb_content = []; // RawNotebookCell[] = [];
		for (const cell of data.cells) {
			nb_content.push({
				kind: cell.kind,
				// language: cell.languageId,
				value: cell.value,
				metadata: cell.metadata
			});
		}
		return new TextEncoder().encode(JSON.stringify(nb_content));
	  }
}

class BooklerNotebookController {
	constructor() {
		this.controllerId = "bookler-notebook-controller";
		this.notebookType = "bookler-notebook";
		this.label = 'Bookler Notebook';
		this.supportedLanguages = ['text'];
		this._controller = vscode.notebooks.createNotebookController(
			this.controllerId,
			this.notebookType,
			this.label
		  );
		this._controller.supportedLanguages = this.supportedLanguages;
		this._controller.supportsExecutionOrder = false;
		this._controller.executeHandler = this._execute.bind(this);
	}

	async _execute(
		allCells,//: vscode.NotebookCell[],
		_notebook,//: vscode.NotebookDocument,
		_controller,//: vscode.NotebookController
	  ) {
		// console.log("_execute _notebook", _notebook);
		// console.log("_execute _controller", _controller);
		for (let cell of allCells) {
		  this._doExecution(cell);
		}
	}
	
	async _doExecution(
		cell //: vscode.NotebookCell
	) {
		if(!cell || cell.metadata == null || cell.metadata.path == null){
			console.log("Saving cell: skipped, no metadata");
			return;
		}
		if(execution_lock > 0){
			const execution = this._controller.createNotebookCellExecution(cell);
			execution.executionOrder = ++this._executionOrder;
			execution.start();
			execution.replaceOutput([
				new vscode.NotebookCellOutput([
				  vscode.NotebookCellOutputItem.text('Try later, other cell working')
				])
			  ]);
			execution.end(false);
			return;
		}
		let date_now = Date.now();
		execution_lock++;
		let cell_notb = cell.notebook;
		let allCells = cell_notb.getCells();
		const execution = this._controller.createNotebookCellExecution(cell);
		execution.executionOrder = ++this._executionOrder;
		execution.start(date_now); // Keep track of elapsed time to execute cell.
		const vs_wedit = new vscode.WorkspaceEdit();
		const vs_nbupdates = [];
		let cell_mt = cell.metadata;
		let cell_path = cell_mt.path;
		let cell_from = cell_mt.char_from;
		let cell_to = cell_mt.char_to;
		let cell_text = cell.document.getText();
		cell_text = utils.strReplaceAll(cell_text, "\r", "");// Forced linux-style
		cell_text = cell_text.trim();
		console.log("Saving cell", cell_mt);
		// Reading data
		let file_data = boo_base.getFileCached(cell_path, true);
		console.log("// initial length", [cell_from, cell_to, file_data.posix_utf8.length, cell_text.length]);
		let file_content = "";
		if(cell_from > 0){
			file_content = file_content+file_data.posix_utf8.substring(0, cell_from);
		}
		file_content = file_content+cell_text;
		file_content = file_content+file_data.posix_utf8.substring(cell_to+1);
		console.log("// final length", file_content.length);
		if(file_data.is_win){
			// Saving data in original new-lines scheme
			// Keeping "/r/n" "/n" file style
			let file_content_win = utils.strReplaceAll(file_content,"\n","\r\n");
			fs.writeFileSync(cell_path, file_content_win);
		}else{
			fs.writeFileSync(cell_path, file_content);
		}
		// Updating meta, shifting positions accordingly
		let cell_mt_upd = {
			path: cell_path,
			char_from: cell_from,
			char_to: cell_from + cell_text.length - 1,
			chid: cell_mt.chid+1
		};
		let nbEdit = vscode.NotebookEdit.updateCellMetadata(cell.index, cell_mt_upd);
		vs_nbupdates.push(nbEdit);
		let cell_mt_offset = cell_mt_upd.char_to-cell_to; //(cell_text.length - (cell_to-cell_from));
		for (let celln of allCells) {
			if(celln == cell || celln.metadata == null || celln.metadata.path == null){
				continue;
			}
			if(celln.metadata.path != cell_path){
				// Not the same file
				continue;
			}
			if(celln.metadata.char_from > cell_from){
				// Need to shift
				let celln_mt_upd = {
					path: celln.metadata.path,
					char_from: celln.metadata.char_from + cell_mt_offset,
					char_to: celln.metadata.char_to + cell_mt_offset,
					chid: celln.metadata.chid+1
				};
				let nbEdit = vscode.NotebookEdit.updateCellMetadata(celln.index, celln_mt_upd);
				vs_nbupdates.push(nbEdit);
			}
		}

		let date_formatted = new Intl.DateTimeFormat('en-GB',{year:"numeric", month:"short", day:"2-digit", hour:"2-digit", minute:"2-digit", second:"2-digit"}).format(date_now);
		// let date_formatted = new Intl.DateTimeFormat('en-GB',{year:"numeric", month:"short",day:"2-digit"}).format(date_now).split(" ").join("-");
		execution.replaceOutput([
		  new vscode.NotebookCellOutput([
			vscode.NotebookCellOutputItem.text('Saved to \''+path.basename(cell_path)+'\' at '+date_formatted)
		  ])
		]);
		let date_end = Date.now()+1;
		// setTimeout(async function(){
		vs_wedit.set(cell_notb.uri, vs_nbupdates);
		await vscode.workspace.applyEdit(vs_wedit);
		cell_notb.save();
		execution.end(true, date_end);
		boo_base.resetFileCache(cell_path);
		execution_lock--;
		// }, 5000);
	}
}

async function makeNotebookForLink(startFile, linkText){
	let date_now = Date.now();
	let date_formatted = new Intl.DateTimeFormat('en-GB',{year:"numeric", month:"short", day:"2-digit", hour:"2-digit", minute:"2-digit", second:"2-digit"}).format(date_now);
	let nb_content = [];
	let start_comms = [
		"Bookler thread for: ["+linkText+"]",
		"Execute cell to save changes into source file."+" "+"New/Removed cells are ignored.",
		"---"
	]
	nb_content.push({kind:1, value: start_comms.join("\n")});

	let linkText_base = linkText;
	let {forwardTags, negativeTags, fileGroups, contextGroups, generalFlags} = boo_base.calcLinkQuery(linkText);
	forwardTags = boo_base.expandTagsWithPrefixes(forwardTags);
	negativeTags = boo_base.expandTagsWithPrefixes(negativeTags);
	// getting forward list of files
	let forward_results = null;
	if(generalFlags.indexOf(boo_base.kOptSkipNotHere) >= 0){
		// Looking in current file only
		forward_results = [ [startFile,0] ];
	}else{
		// All possible results
		forward_results = boo_base.findBookletLinkLocations(startFile, forwardTags, false, true);
	}
	let forward_paths = [];
	let forward_datas = {};
	for(fr of forward_results){
		let boo_file_path =fr[0];
		// Checking fileGroups, if present
		let isFileOk = true;
		if(fileGroups.length > 0){
			isFileOk = false;
			for(fg of fileGroups){
				if(utils.strIndexOfAllX(boo_file_path, fg).length > 0){
					isFileOk = true;
					break;
				}
			}
		}
		if(!boo_file_path || isFileOk == false){
			continue;
		}
		if(forward_datas[boo_file_path] != null){
			continue;
		}
		let file_data = boo_base.getFileCached(boo_file_path);
		if(!file_data){
			console.log("- WARNING: no file data for path:", boo_file_path, "possible reasons: file size limit reached");
			continue;
		}
		forward_datas[boo_file_path] = file_data;
		forward_paths.push(boo_file_path);
	}

	// Getting valid blocks - in proper order, with source-mapping metadata
	// newlines: также для вытаскивания строки где тег, с нее тащить контекст
	let okCnt = 0;
	let file_blocks_total = [];
	for(file_path of forward_paths){
		let file_dat = forward_datas[file_path];
		if(!file_dat){
			continue;
		}
		let file_blocks = boo_base.calcTextBlocks(file_dat.posix_utf8, file_dat.idx_newlines);
		for(fb of file_blocks){
			let fb_text = file_dat.posix_utf8.substring(fb.pos_from, fb.pos_to+1);
			fb.sort_key = file_path.padEnd(256, '.') + (""+fb.pos_from).padStart(10, '0');
			let block_context = "";
			let isForwardTagsPresent = false;
			let isNegativeReasonsPresent = false;
			for(let tg of forwardTags){
				let tg_idx_all = utils.strIndexOfAllX(fb_text, tg);
				if(tg_idx_all.length > 0){
					let tg_first_pos = tg_idx_all[0];
					isForwardTagsPresent = true;
					// Need to get context. getting line first
					let test_text = "\n"+fb_text+"\n";
					let startFence = utils.strIndexOfAnyLeft(test_text, tg_first_pos+1, ["\n"]);
					let endFence = utils.strIndexOfAnyRight(test_text, tg_first_pos+1, ["\n"]);
					if(startFence.idx >= 0 && endFence.idx >= 0){
						tg_first_pos = tg_first_pos-startFence.idx;// Position relative start of line
						let test_line = test_text.substring(startFence.idx, endFence.idx+1);
						let test_line_firstdd = test_line.indexOf(boo_base.kTagContextFencing);
						if(test_line_firstdd < tg_first_pos){
							// ther is context mark found: "/n...: ... <tag> .../n"
							let startFence2 = utils.strIndexOfAnyLeft(test_line, test_line_firstdd, boo_base.kTagWhitespaceFencing);
							if(startFence2.idx >= 0){
								block_context = test_line.substring(startFence2.idx, test_line_firstdd);
							}
						}
					}
					if(generalFlags.indexOf(boo_base.kOptSkipNoContext) >= 0 && block_context.length == 0){
						// tag usage has no context, skipping such block
						isNegativeReasonsPresent = true;
					}
					let needContextSort = false;
					if(contextGroups.length > 0){
						needContextSort = true;
					}
					// if(generalFlags.indexOf(boo_base.kOptContextSortAlways) >= 0){
					// 	needContextSort = true;
					// }
					if(needContextSort){
						// block sort order should include context
						let groupIdx = 999;
						// contextGroups marks should go first, in defined order
						if(contextGroups.length > 0 && block_context.length > 0 && contextGroups.indexOf(block_context) >= 0){
							groupIdx = contextGroups.indexOf(block_context);
						}
						fb.sort_key = (""+groupIdx).padStart(5, '0')+block_context.padEnd(20, '.')+fb.sort_key;
					}
					// console.log("- matched block found", fb_text, tg, block_context, generalFlags);
					break;
				}
			}
			for(let tg of negativeTags){
				let tg_idx_all = utils.strIndexOfAllX(fb_text, tg);
				if(tg_idx_all.length > 0){
					isNegativeReasonsPresent = true;
					break;
				}
			}
			// console.log("- block test", fb_text, isForwardTagsPresent, isNegativeTagsPresent, forwardTags, negativeTags);
			if(!isForwardTagsPresent || isNegativeReasonsPresent){
				// Skipping
				continue;
			}
			fb.source_file = file_path;
			fb.source_block_text = fb_text;
			// Checking vailidy
			file_blocks_total.push(fb);
		}
	}
	// Sort according to sort key
	file_blocks_total.sort(function(a, b){
		if(a.sort_key < b.sort_key) { return -1; }
		if(a.sort_key > b.sort_key) { return 1; }
		return 0;
	});
	for(fb of file_blocks_total){
		okCnt = okCnt+1;
		let block_text = fb.source_block_text;
		let block_meta = {path: fb.source_file, char_from: fb.pos_from, char_to: fb.pos_to, chid:0};
		// console.log("- block:"+fb.source_file+":"+fb.pos_from);
		// nb_content.push({kind:1, value:"// "+fb.source_file+":"+fb.pos_from+" ["+fb.sort_key+"]"});
		nb_content.push({kind:0, value:block_text, metadata:block_meta});
	}

	// Final comments
	let final_comms = [
		"---",
		"Blocks in thread: "+okCnt+"; Generated: "+date_formatted
	]
	nb_content.push({kind:1, value:final_comms.join("\n")});

	// Unsaved notebook - problematic
	// let cells = [];
	// for(item of nb_content){
	// 	let cell = new vscode.NotebookCellData(item.kind, item.value, "text");
	// 	cell.metadata = item.metadata;
	// 	cells.push(cell);
	// };
	// let doc_dat = new vscode.NotebookData(cells);
	// let doc = await vscode.workspace.openNotebookDocument("bookler-notebook", doc_dat);

	// Saving to temp location
	let nb_tmp_name = linkText_base;
	nb_tmp_name = utils.strReplaceAll(nb_tmp_name,",","-");
	nb_tmp_name = utils.strReplaceAll(nb_tmp_name,".","-");
	nb_tmp_name = utils.strReplaceAll(nb_tmp_name,"&","-");
	nb_tmp_name = utils.strReplaceAll(nb_tmp_name,"=","-");
	nb_tmp_name = utils.strReplaceAll(nb_tmp_name," ","");
	nb_tmp_name = utils.strReplaceAll(nb_tmp_name,"?","");
	nb_tmp_name = utils.strReplaceAll(nb_tmp_name,":","");
	nb_tmp_name = utils.strReplaceAll(nb_tmp_name,"/","");
	nb_tmp_name = utils.strReplaceAll(nb_tmp_name,"*","");
	let tag_prefixes = boo_base.getConfigArray("contentTagPrefix");
	for(pref of tag_prefixes){
		nb_tmp_name = utils.strReplaceAll(nb_tmp_name,pref,"");
	}
	let nb_filepath = utils.pathToPosix(os.tmpdir()) + "/" + "Thread="+nb_tmp_name+"_"+Math.floor(date_now/1000)+".bookler";
	// fs.removeSync(nb_filepath);
	fs.writeJsonSync(nb_filepath, nb_content);
	console.log("Bookler notebook: saved to", nb_filepath);
	return nb_filepath;
}

module.exports = {
	makeNotebookForLink,
	BooklerNotebookSerializer,
	BooklerNotebookController
}