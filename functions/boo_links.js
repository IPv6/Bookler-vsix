const vscode = require('vscode');
const boo_base = require('./boo_base.js');
const boo_thread = require('./boo_thread.js');
const utils = require('./utils.js');

// const slipPosition = (document, position, dir, flagStr) => {
// 	let nextPosition = position;
// 	let prePosition, tmpPosition;
// 	let text;
// 	do {
// 		text = null;
// 		prePosition = nextPosition;
// 		try{// negative positions may throw
// 			nextPosition = prePosition.translate(0, dir);
// 			text = document.getText(new vscode.Range(nextPosition, prePosition));
// 		}catch(e){break};
// 		if (!text || text.length == 0 || isNaN(text.charCodeAt(0)) || text == "\n" || text == "\r"){
// 			break
// 		}
// 		if(flagStr.length > 1){
// 			try{// negative positions may throw
// 				tmpPosition = prePosition.translate(0, dir * flagStr.length);
// 				text = document.getText(new vscode.Range(tmpPosition, prePosition));
// 			}catch(e){break};
// 		}
// 		if (text == flagStr){
// 			break
// 		}
// 	} while (text && text.length > 0);
// 	if (text !== flagStr) {
// 		return null;
// 	}
// 	return prePosition;
// };

async function getBookletTagDefinition(document, position) {
	try{
		let clickedLine = document.lineAt(position).text;
		let startFence = utils.strIndexOfAnyLeft(clickedLine, position.character, [boo_base.kWikiLinksFencing[0]]);
		let endFence = utils.strIndexOfAnyRight(clickedLine, position.character, [boo_base.kWikiLinksFencing[1]]);
		// startPosition = slipPosition(document, position, -1, kWikiLinksFencing[0]);
		// if(startPosition != null){
		// 	endPosition = slipPosition(document, position, 1, kWikiLinksFencing[1]);
		// }
		if(startFence.idx < 0 || endFence.idx < 0){
			return;
		}
		let startPosition = new vscode.Position(position.line, startFence.idx+startFence.stop.length);
		let endPosition = new vscode.Position(position.line, endFence.idx);
		let clickedText = document.getText(new vscode.Range(startPosition, endPosition));
		clickedText = clickedText.trim();
		console.log("Bookler: clicked on Booklet link:", clickedText);
		if(clickedText.length == 0){
			return null;
		}
		let threadbld_prefix = "?:";
		if(clickedText.indexOf(threadbld_prefix) == 0){
			let nb_filepath = await boo_thread.makeNotebookForLink(document.fileName, clickedText.substring(threadbld_prefix.length));
			// let doc = await vscode.workspace.openNotebookDocument(vscode.Uri.file(nb_filepath) );
			// await vscode.window.showNotebookDocument(doc);
			const location = new vscode.Location(vscode.Uri.file(nb_filepath), new vscode.Position(0, 0));
			return location;
		}
		let result_total = boo_base.findBookletLinkLocations(document.fileName, clickedText, true, true);
		const positions = [];
		for(reslt of result_total){
			const location = new vscode.Location(vscode.Uri.file(reslt[0]), new vscode.Position(reslt[1], 0));
			positions.push(location);
		}
		if(positions.length > 1){
			return positions;
		}
		if(positions.length == 1){
			return positions[0];
		}
	}catch(e){
		console.log("getBookletTagDefinition: error", e);
	}
	return null;
};

module.exports = {
	getBookletTagDefinition
}