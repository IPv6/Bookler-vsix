// https://code.visualstudio.com/api/language-extensions/programmatic-language-features#show-definitions-of-a-symbol
// https://code.visualstudio.com/api/extension-guides/notebook
// https://code.visualstudio.com/api/references/commands

const vscode = require('vscode');
const utils = require('./utils.js');
const boo_base = require('./boo_base.js');
const boo_links = require('./boo_links.js');
const boo_thread = require('./boo_thread.js');

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
	// console.log("Bookler: activating extension...");
	let disposable = null;
	// disposable = vscode.commands.registerCommand('bookler.showStats', function () {
	// 	var stats = boo_base.getStats();
	// 	console.log('Bookler stats:', stats);
	// 	vscode.window.showInformationMessage('Bookler stats:'+stats.summary);
	// });
	// context.subscriptions.push(disposable);
	disposable = vscode.commands.registerCommand('bookler.dropCache', function () {
		boo_base.resetCaches();
		vscode.window.showInformationMessage('Bookler caches dropped');
	});
	context.subscriptions.push(disposable);
	disposable = vscode.workspace.registerNotebookSerializer('bookler-notebook', new boo_thread.BooklerNotebookSerializer())
	context.subscriptions.push(disposable);
	context.subscriptions.push(new boo_thread.BooklerNotebookController());

	const contentFilesGlobs = boo_base.getConfigArray("collectFilesByName");
	const defprovDocSelector = contentFilesGlobs.map(function (pt) {return { scheme: 'file', pattern: pt }});
	disposable = vscode.languages.registerDefinitionProvider(
		defprovDocSelector, // [{ pattern: "**/*" }],
		{
			provideDefinition: boo_links.getBookletTagDefinition
		}
	);
	context.subscriptions.push(disposable);
	// // Empty hoover to avoid use provideDefinition for hoovers
	// disposable = vscode.languages.registerHoverProvider(
	// 	defprovDocSelector,
	// 	{
	// 		provideHover: function(document, position, token){return new Hover('Click to see');}
	// 	}
	// );
	// context.subscriptions.push(disposable);

	// register a configuration change listener - just a warning
	vscode.workspace.onDidChangeConfiguration((e) => {
		if (e.affectsConfiguration("bookler")) {
			vscode.window.showInformationMessage('Bookler configuration changed: please restart vscode');
		}
	});
}

// This method is called when your extension is deactivated
function deactivate() {}

module.exports = {
	activate,
	deactivate
}
