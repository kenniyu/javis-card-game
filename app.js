
/**
 * Module dependencies.
 */

var express = require('express')
  , routes = require('./routes')

var app = module.exports = express.createServer();
var nowjs = require('now');

// Configuration

app.configure(function(){
  app.set('views', __dirname + '/views');
  app.set('view engine', 'ejs');
  app.use(express.bodyParser());
  app.use(express.methodOverride());
  app.use(app.router);
  app.use(express.static(__dirname + '/public'));
});

app.configure('development', function(){
  app.use(express.errorHandler({ dumpExceptions: true, showStack: true })); 
});

app.configure('production', function(){
  app.use(express.errorHandler()); 
});

// Routes

app.get('/', function(req, res){
	res.render('index');
});

app.get('/game', function(req, res){
	res.render('game');
});

app.listen(3000);
console.log("Express server listening on port %d in %s mode", app.address().port, app.settings.env);

var everyone = nowjs.initialize(app);
var usersHash = {};

var anonId = 1;
var observerId = 1;
var deck = [];
var maxPlayers = 4;
var gameState = {"isPlaying": false, "currentPlayer": 0, "players": [], "currentPlaySize": null, "currentPlayHistory": [], "discardPile": [], "moves": 0, "activePlayers": [], "places": [], "moveBits": [], "jackCounter": 0};
var waitingPlayers = [];

// when a client connects
nowjs.on('connect', function() {
	var name, basename;
	var clientId = this.user.clientId;
	var nameIsUnique = true;
	var numPlayers = getNumPlayers();
	
	basename = "Player";
	
	while (true){
		name = basename + anonId;
		for (var key in usersHash){
			if (usersHash[key]["name"] == name){
				nameIsUnique = false;
				break;
			}
		}
		if (nameIsUnique){
			var userType = ((numPlayers < 4 && !gameState["isPlaying"]) ? "Player" : "Observer");
			this.now.name = name;
			usersHash[clientId] = {"id": clientId, "name": name, "type": userType, "score": 0, "hand": []};
			if (userType == "Observer"){
				initObserverView(clientId);
				waitingPlayers.push(clientId);
			}
			break;
		}
		else{
			anonId++;
		}
	}
	anonId++;
	
	// update the chat and scoreboard
	broadcastJoin(clientId);
	everyone.now.updateScoreboard(usersHash);
	
	// show everyone start button
	if (getNumPlayers() > 1 && !gameState["isPlaying"]){
		var playerIds = getPlayerIds();
		// show players the start button
		playerIds.forEach(function(playerId){
			nowjs.getClient(playerId, function(){
				this.now.showStartButton();
				this.now.removeWaitForGame();
				this.now.removeGameOverButton();
			});
		});
	}
	else if (getNumPlayers() == 1){
		// show players the wait for game
		everyone.now.showWaitForGame();
	}
});

// when a client disconnects
nowjs.on('disconnect', function() {
	var clientId = this.user.clientId;
	// update chat
	broadcastLeave(clientId);
	
	var playerIndex = gameState["players"].indexOf(clientId);
	if (playerIndex > -1){
		console.log("removing player "+clientId+" and his index is "+playerIndex);
		removeFromPlayerHand(usersHash[clientId]["hand"], clientId);	// hand is the hand to remove
		// udpate gameState vars
		gameState["moveBits"][playerIndex] = -1
		gameState["activePlayers"].splice(gameState["activePlayers"].indexOf(clientId), 1);
		console.log(gameState);
		
		if (gameState["currentPlayer"] == clientId){
			alertNextPlayer();
			// everyone.now.showCurrentPlayer(gameState["currentPlayer"]);
		}
		
		checkGameOver();
	}
	// delete user from the server
	delete usersHash[clientId];
	
	// update scoreboard
	everyone.now.updateScoreboard(usersHash);
	
	if (gameState["isPlaying"] == false && Object.size(usersHash) < 2){
		// hide the start button
		everyone.now.removeStartButton();
		everyone.now.showWaitForGame();
	}
});

everyone.now.waitForGame = function(){
	var playerIds = getPlayerIds();
	var numPlayers = playerIds.length;
	everyone.now.removeGameOverButton();
	if (numPlayers > 1){
		// tell everyone to init game
		everyone.now.removeWaitForGame();
		everyone.now.showStartButton();
	}
	else{
		everyone.now.showWaitForGame();
	}
}

// called when anyone on client side presses start game button
everyone.now.initGame = function(){
	// check to make sure gameState isPlaying is really false in case of concurrency issues?
	if (!gameState["isPlaying"]){
		gameState["isPlaying"] = true;		// we are now playing...
	
		// hide the start button for all clients
		everyone.now.removeStartButton();
		everyone.now.removeGameOverButton();
		everyone.now.removeWaitForGame();
		everyone.now.clearStage();
		everyone.now.clearDiscardPile();
		everyone.now.clearSlots();
		
		
		// if there are any waiting players, make sure they get taken off the queue and get assigned as players:
		var playerIds = getPlayerIds();
		var numPlayers = playerIds.length;
		if (numPlayers < 4 && waitingPlayers.length > 0){
			var freeSeats = 4 - numPlayers;
			var playersToAdd = Math.min(freeSeats, waitingPlayers.length);
			for (var i = 0; i < playersToAdd; i++){
				var clientId = waitingPlayers.shift();	// remove first in line from waitingPlayers
				usersHash[clientId]["type"] = "Player";	// assign as player
			}
		}
		everyone.now.updateScoreboard(usersHash);
	
		initDeck();							// initialize the deck
	 	deck = shuffleCards(deck);			// shuffle the deck
		
		assignHands();						// assigns each players hand on the backend
		dealPlayerHands();					// deals each players hand on the frontend
		beginPlaying();						// start taking turns
	}
}

function broadcastJoin(clientId){
	// update the chat
	var name = getPlayerName(clientId);
	var text = " is here.";
	var userInfo = {"id": clientId, "name": name};
	var messageHash = {"userInfo": userInfo, "type": "emote", "text": text}
	everyone.now.updateChat(messageHash);
}

function broadcastLeave(clientId){
	var name = getPlayerName(clientId);
	if (name != null){
		var text = " left.";
		var userInfo = {"id": clientId, "name": name};
		var messageHash = {"userInfo": userInfo, "type": "emote", "text": text}
		everyone.now.updateChat(messageHash);
	}
}

function initObserverView(clientId){
	var playerIds = getPlayerIds();		// get array of player ids
	var numPlayers = playerIds.length;	// get number of players
	
	playerIds.forEach(function(playerId, index){
		// var dummyHand = [];
		var playerHand = usersHash[playerId]["hand"];
		var dummyHand = [];
		playerHand.forEach(function(card){
			dummyHand.push("");
		});
		
		nowjs.getClient(clientId, function(){
			this.now.dealOtherHand(dummyHand, index, numPlayers, false);
			var playerName = usersHash[playerId]["name"];
			this.now.showPlayerName(index, playerName, playerId, numPlayers);
			this.now.showCurrentPlayer(gameState["currentPlayer"]);
		});
	});
	
	// set the stage. TODO (only loads last hand for some reason)
	var currentPlayHistory = gameState["currentPlayHistory"];
	currentPlayHistory.forEach(function(hand){
		nowjs.getClient(clientId, function(){
			this.now.addToCurrentPlay(hand);
		});
	});
	
	// set the discard pile
	var numDiscarded = gameState["discardPile"].length;
	var dummyHand = [];
	for (var i = 0; i < numDiscarded; i++){
		dummyHand.push("");
	}
	nowjs.getClient(clientId, function(){
		this.now.addToDiscardPile(dummyHand);
	});
}

// assign each players hands on the server side
function assignHands(){
	var numPlayers = getNumPlayers();		// we need to get number of players for later...
	var playerIds = getPlayerIds();			// and each player's ids
	console.log("Player ids:" + playerIds);
	
	if (numPlayers == 4){					// if we have 4 players, this is how we assign each user's cards
		playerIds.forEach(function(clientId){
			usersHash[clientId]["hand"] = deck.splice(0,13);
		});
	}
	else if (numPlayers == 2){				// otherwise if we have 2 players...
		playerIds.forEach(function(clientId){
			usersHash[clientId]["hand"] = deck.splice(0,17);
		});
	}
	else if (numPlayers == 3){				// otherwise if we have 3 players...
		var tempSubarray;
		playerIds.forEach(function(clientId){
			var threeOfClubsIndex = deck.indexOf("3C");
			if (threeOfClubsIndex > -1 && threeOfClubsIndex < 17){
				usersHash[clientId]["hand"] = deck.splice(0,18);
			}
			else{
				usersHash[clientId]["hand"] = deck.splice(0,17);
			}
		});
	}
}

function addToPlayerHand(cards, playerId){
	// this player just drew some cards, so update everyone's view of his hand
	console.log(cards);
	nowjs.getClient(playerId, function(){
		this.now.addToPersonalHand(cards);
	});
	
	// update everyone elses view of the player's hand
		
	var playerIds = gameState["players"];		// get array of player ids
	var numPlayers = playerIds.length;	// get number of players in the game (leavers, finishers included)
	var playerIndex = playerIds.indexOf(playerId);
	for (var i = playerIndex + 1; i < playerIndex + numPlayers; i++){
		var otherPlayerId = playerIds[i%numPlayers];
		var otherPlayerIndex = playerIds.indexOf(otherPlayerId);
		
		var relativeIndex = 0;
		for (var j = otherPlayerIndex + 1; j < otherPlayerIndex + numPlayers; j++){
			if (playerIds[j%numPlayers] == playerId){
				break;
			}
			relativeIndex++;
		}
		
		if (usersHash[otherPlayerId] != undefined){
			nowjs.getClient(otherPlayerId, function(){
				// this.now.dealOtherHand(dummyHand, relativeIndex, numPlayers, false);
				this.now.addToOtherHand(cards.length, relativeIndex, numPlayers);
			});
		}
	}
	
	var observerIds = getObserverIds();
	observerIds.forEach(function(observerId){
		// for each observer, update their view of the player's hand
		nowjs.getClient(observerId, function(){
			this.now.addToOtherHand(cards.length, relativeIndex, numPlayers);
			// this.now.dealOtherHand(dummyHand, playerIndex, numPlayers, false);
		});
	});
}

function removeFromPlayerHand(hand, playerId){
	// a player has just played a hand, so update everyone's view of his hand
	// playerId is the player who just played, update his frontend
	var playerHand = usersHash[playerId]["hand"];
	nowjs.getClient(playerId, function(){
		this.now.removeFromPersonalHand(hand);
		// this.now.dealPersonalHand(usersHash[playerId]["hand"]);
	});
	
	// update everyone elses view of the player's hand
		
	var playerIds = gameState["players"];		// get array of player ids
	var numPlayers = playerIds.length;	// get number of players in the game (leavers, finishers included)
	var playerIndex = playerIds.indexOf(playerId);
	for (var i = playerIndex + 1; i < playerIndex + numPlayers; i++){
		var otherPlayerId = playerIds[i%numPlayers];
		var otherPlayerIndex = playerIds.indexOf(otherPlayerId);
		
		var relativeIndex = 0;
		for (var j = otherPlayerIndex + 1; j < otherPlayerIndex + numPlayers; j++){
			if (playerIds[j%numPlayers] == playerId){
				break;
			}
			relativeIndex++;
		}
		
		if (usersHash[otherPlayerId] != undefined){
			nowjs.getClient(otherPlayerId, function(){
				// this.now.dealOtherHand(dummyHand, relativeIndex, numPlayers, false);
				this.now.removeFromOtherHand(hand.length, relativeIndex, numPlayers);
			});
		}
	}
	
	var observerIds = getObserverIds();
	observerIds.forEach(function(observerId){
		// for each observer, update their view of the player's hand
		nowjs.getClient(observerId, function(){
			this.now.removeFromOtherHand(hand.length, relativeIndex, numPlayers);
			// this.now.dealOtherHand(dummyHand, playerIndex, numPlayers, false);
		});
	});
}

// loops through all players and deals their hands on the client side, also shows their names
function dealPlayerHands(){
	var numPlayers = getNumPlayers();
	var playerIds = getPlayerIds();
	
	playerIds.forEach(function(clientId){
		// for each player...update their client side
		nowjs.getClient(clientId, function(){
			// deal this player's personal hand by first sorting, then calling dealPersonalHand on client side
			usersHash[clientId]["hand"] = sortHand(usersHash[clientId]["hand"]);	
			console.log("player "+clientId+" with " + usersHash[clientId]["hand"].length + " cards: "+ usersHash[clientId]["hand"]);
			this.now.dealPersonalHand(usersHash[clientId]["hand"]);					
			
			// deal other players hands
			var myPlayerIndex = playerIds.indexOf(clientId);
			var playerIndex = 0;
			for (var i = myPlayerIndex + 1; i < myPlayerIndex + numPlayers; i++){
				var dummyHand = [];
				var otherPlayerId = playerIds[i%numPlayers];
				var otherPlayerHand = usersHash[otherPlayerId]["hand"];
				otherPlayerHand.forEach(function(card){
					dummyHand.push("");
				});
				this.now.dealOtherHand(dummyHand, playerIndex, numPlayers, false);
				var playerName = usersHash[otherPlayerId]["name"];
				this.now.showPlayerName(playerIndex, playerName, otherPlayerId, numPlayers);
				playerIndex++;
			}
		});
	});
}

// gets the starting playerId
function getStartingPlayer(playerIds){
	var startingPlayerId;
	var minCardValue = 99;
	var tempValue;
	playerIds.forEach(function(playerId){
		tempValue = getValueWithSuit(usersHash[playerId]["hand"][0]);
		if (tempValue < minCardValue){
			minCardValue = tempValue;
			startingPlayerId = playerId;
		}
	});
	return startingPlayerId;
}

// finds the starting player and shows his make move button, sets appropriate game state vars
function beginPlaying(){
	// figure out starting player
	var playerIds = getPlayerIds();
	
	var startingPlayerId = getStartingPlayer(playerIds);
	var playerName = usersHash[startingPlayerId]["name"];
	
	// set gameState vars
	playerIds.forEach(function(playerId){
		gameState["players"].push(playerId);
		gameState["activePlayers"].push(playerId);
	});
	gameState["currentPlayer"] = startingPlayerId;
	gameState["moveBits"] = [1,1,1,1].slice(0, playerIds.length);
	
	// starting player must make a move
	everyone.now.showCurrentPlayer(startingPlayerId);
	nowjs.getClient(startingPlayerId, function(){
		this.now.showMakeMoveButton();
	});
}

everyone.now.sendMove = function(hand){
	hand = sortHand(hand);
	if (checkRules(hand)){
		// valid hand, game state should've already been updated
		console.log("===============valid hand==============");
		console.log(gameState);
		
		// set move bits to 1 (more details in function)
		setMoveBitsToOne();
		
		var clientId = this.user.clientId;
		// remove the hand from the player who made the move (BACKEND)
		removeCardsFromHand(hand, clientId);		
		// update everyone's view of the player's hand based on what he played (FRONTEND)
		removeFromPlayerHand(hand, clientId);
		// update everyone's view of the stage (FRONTEND)
		everyone.now.addToCurrentPlay(hand);	
		
		// LOGISTICS
		// check for 5's
		checkForFives(hand, clientId);
		// check for J's
		checkForJacks(hand, clientId);
		
		// check if the player who just played now has an empty hand
		checkEmptyHand(clientId);
		
		if (containsEight(hand)){
			passEveryone();
			resetJackCounter();
		}
		else{
			if (gameState["jackCounter"] > 0){
				// there is a jack in play
				if (canPlayLower(hand)){
					// can play lower
					alertNextPlayer();
				}
				else{
					// cant play lower, so alert jack player
					// alertJackPlayer();
					alertNextPlayer();
				}
			}
			else{
				// there is no jack in play
				if (canPlayHigher(hand)){
					// the hand just played can be beaten, so alert the next player to make a move
					alertNextPlayer();
				}
				else{
					// the hand just played CANNOT be beaten, so pass everyone
					passEveryone();
				}
			}
		}
		updateJackCounter();
		notifyJackInPlay();
	}
	else{
		var message = "Bad hand. Try again.";
		this.now.showErrorMessage(message);
		
		// show make move button again
		this.now.showMakeMoveButton();
		// only show the pass button if it's NOT the first hand of the round
		if (gameState["currentPlaySize"] != null){
			this.now.showMakePassMoveButton();
		}
		notifyJackInPlay();
	}
}

function updateJackCounter(){
	if (gameState["jackCounter"] > 0){
		gameState["jackCounter"] -= 1;
	}
}

function resetJackCounter(){
	gameState["jackCounter"] = 0;
}

function checkForFives(hand, clientId){
	var numFives = 0;
	for (var i = 0; i < hand.length; i++){
		var card = hand[i];
		if (card[0] == "5"){
			numFives++;
		}
	}
	var numDiscard = gameState["discardPile"].length;
	var cardsToAdd = [];
	for (var i = 0; i < Math.min(numFives, numDiscard); i++){
		var randomCard = gameState["discardPile"].splice(Math.random()*gameState["discardPile"].length, 1);
		cardsToAdd.push(randomCard);
		usersHash[clientId]["hand"].push(randomCard);
	}
	cardsToAdd = cardsToAdd.flatten();
	if (cardsToAdd.length > 0){
		sortHand(usersHash[clientId]["hand"]);
		addToPlayerHand(cardsToAdd, clientId);
		everyone.now.removeFromDiscardPile(cardsToAdd.length);
	}
}

function checkForJacks(hand){
	for (var i = 0; i < hand.length; i++){
		var card = hand[i];
		if (card[0] == "J"){
			gameState["jackCounter"] = gameState["activePlayers"].length;
			break;
		}
	}
	console.log(gameState["jackCounter"]);
}

function containsEight(hand){
	for (var i = 0; i < hand.length; i++){
		var card = hand[i];
		if (card[0] == "8"){
			return true;
		}
	}
}

function canPlayHigher(hand){	
	// can hand be beaten with a higher one?
	if (hand.length == 1){
		var card = hand[0];
		if (card[0] == "2"){
			return false;
		}
	}
	else if (hand.length == 2){
		var handValue = getHandValue(hand);
		if (handValue == 30){
			return false;
		}
	}
	else if (hand.length == 5){
		if (isFourKind(hand) && getFourKindValue(hand) == 60){
			return false;
		}
	}
	return true;
}

function canPlayLower(hand){
	if (hand.length == 1){
		var card = hand[0];
		if (card[0] == "3"){
			return false;
		}
	}
	else if (hand.length == 2){
		var handValue = getHandValue(hand);
		if (handValue == 6){
			return false;
		}
	}
	else if (hand.length == 5){
		if (isStraight(hand) && getStraightValue(hand) == 25){
			return false;
		}
	}
	return true;
}

function setMoveBitsToOne(){
	// after a send move, find all people with bit != -1 and set it to 1.
	// effectively assumes that everyone can play on that hand
	// also gets called when a round ends (and new round begins), as a reset
	gameState["moveBits"].forEach(function(bit, index){
		if (bit != -1){
			gameState["moveBits"][index] = 1;
		}
	});
}

function checkEmptyHand(clientId){
	// called when a player sends a move
	var tempHand = usersHash[clientId]["hand"];
	var playerIndex = gameState["players"].indexOf(clientId);
	if (tempHand.length == 0){
		var activePlayerIndex = gameState["activePlayers"].indexOf(clientId);
		
		gameState["moveBits"][playerIndex] = -1;		// use -1 to indicate the player is done playing
		
		gameState["activePlayers"].splice(activePlayerIndex, 1);
		gameState["places"].push(clientId);
		updateScores(gameState["places"].length - 1);
		
		checkGameOver();
	}
	else{
		// set player who just made a move to 2
		gameState["moveBits"][playerIndex] = 2;
	}
}

// game over functions
function checkGameOver(){
	if (gameState["activePlayers"].length == 1){
		// if there's only one active player left, then the game is over, so call gameOver		
		gameOver();
	}
}

function gameOver(){
	// update places
	gameState["places"].push(gameState["activePlayers"].pop());
	// broadcast game over
	broadcastGameOver();
	// reset the game
	clearGame();
}

function updateScores(index){
	var places = gameState["places"];
	var clientId = places[index];
	var numCardsLeftInGame = getNumCardsLeft();
	usersHash[clientId]["score"] += numCardsLeftInGame;
	everyone.now.updateScoreboard(usersHash);
}

function getNumCardsLeft(){
	var playerIds = getPlayerIds();
	var numCardsLeft = 0;
	playerIds.forEach(function(playerId){
		numCardsLeft += usersHash[playerId]["hand"].length;
	})
	return numCardsLeft;
}

function broadcastGameOver(){
	// broadcasts to true players (players left in the game)
	var playerIds = getPlayerIds();
	playerIds.forEach(function(playerId){
		nowjs.getClient(playerId, function(){
			this.now.handleGameOver();
		});
	});
}

function clearGame(){
	gameState = {"isPlaying": false, "currentPlayer": 0, "players": [], "currentPlaySize": null, "currentPlayHistory": [], "discardPile": [], "moves": 0, "activePlayers": [], "places": [], "moveBits": [], "jackCounter": 0};
	deck = [];
}


function getPlayerName(playerId){
	if (usersHash[playerId] != undefined){
		return usersHash[playerId]["name"];
	}
	return null;
}

function notifyJackInPlay(){
	if (gameState["jackCounter"] > 0){
		var currentPlayer = gameState["currentPlayer"];
		nowjs.getClient(currentPlayer, function(){
			this.now.showJackMessage();
		});
	}
}

function alertCurrentPlayer(){
	// this gets called if everyone else autopasses
	var currentPlayer = gameState["currentPlayer"];
	nowjs.getClient(currentPlayer, function(){
		this.now.showMakeMoveButton();
	});
}

function alertNextPlayer(){
	// finds the next player with moveBit != -1
	var players = gameState["players"];
	
	if (players.length > 0){
		var nextPlayerIndex = (players.indexOf(gameState["currentPlayer"])+1)%(players.length);
		while (gameState["moveBits"][nextPlayerIndex] == -1){
			nextPlayerIndex = (nextPlayerIndex+1)%(players.length);
		}
		var nextPlayerId = players[nextPlayerIndex];

		everyone.now.showCurrentPlayer(nextPlayerId);
		nowjs.getClient(nextPlayerId, function(){
			gameState["currentPlayer"] = nextPlayerId;
			this.now.showMakeMoveButton();
			this.now.notifyTurn();
			if (gameState["currentPlayHistory"].length != 0){
				this.now.showMakePassMoveButton();
			}
		});
	}
}

function passToJackPlayer(){
	var currentPlayer = gameState["currentPlayer"];
	var players = gameState["players"];
	
	// get the active players besides the player who just played the hand
	var playersToPass = [];
	players.forEach(function(playerId){
		if (gameState["activePlayers"].indexOf(playerId) > -1 && playerId != currentPlayer){
			playersToPass.push(playerId);
		}
	});	
}

function passEveryone(){
	// makes everyone pass. called when a player plays an unbeatable hand
	var currentPlayer = gameState["currentPlayer"];
	var players = gameState["players"];
	
	// get the active players besides the player who played the unbeatable hand
	var playersToPass = [];
	players.forEach(function(playerId){
		if (gameState["activePlayers"].indexOf(playerId) > -1 && playerId != currentPlayer){
			playersToPass.push(playerId);
		}
	});
	
	var numPlayers = playersToPass.length;
	if (numPlayers > 0){	// sanity check
		console.log("players to pass = " + playersToPass);
		
		setTimeout(function(){
			playersToPass.forEach(function(playerId){
				nowjs.getClient(playerId, function(){
					// show auto pass message
					this.now.showAutoPass();
				});
			});
		}, 100);
		
		// remove the auto pass message after 1000 ms
		setTimeout(function(){
			playersToPass.forEach(function(playerId){
				nowjs.getClient(playerId, function(){
					// remove auto pass message
					this.now.removeAutoPass();
				});
			});
			handleEveryonePass();
			if (usersHash[currentPlayer]["hand"].length == 0){
				alertNextPlayer();
			}
			else{
				alertCurrentPlayer();
			}
		}, 1000);
	}
}

function removeCardsFromHand(cards, clientId){
	// removes cards from the players hand (BACKEND)
	var tempHand = usersHash[clientId]["hand"];
	var indexOfCard;
	cards.forEach(function(card){
		indexOfCard = tempHand.indexOf(card);
		tempHand.splice(indexOfCard, 1);
	});
	usersHash[clientId]["hand"] = tempHand;
}

function handleEveryonePass(){
	// what to do when everyone passes
	everyone.now.clearStage();		// clear the stage for everyone (FRONTEND)
	
	// get all the cards played in the current round and shove to discard pile
	var currentRoundCards = gameState["currentPlayHistory"].flatten();		
	var numDiscarded = currentRoundCards.length;
	var dummyHand = [];
	currentRoundCards.forEach(function(card){
		gameState["discardPile"].push(card);
		dummyHand.push("");
	});
	// update play history and play size
	gameState["currentPlayHistory"] = [];
	gameState["currentPlaySize"] = null;
	
	// reset moveBits to 1 for all active players
	setMoveBitsToOne();
	
	// update the discard pile (FRONTEND)
	everyone.now.addToDiscardPile(dummyHand);
}

everyone.now.sendPassMove = function(){
	// decrement the jack counter:
	updateJackCounter();
	
	var clientId = this.user.clientId;
	console.log("client "+ clientId + " is passing");
	var playerIndex = gameState["players"].indexOf(clientId);
	
	var everyonePassed = false;
	gameState["moveBits"][playerIndex] = 0;		// use 0 to indicate that the player has just passed
	// check that all players (with cards) have passed. just check that there are no 1's
	if (gameState["moveBits"].indexOf(1) == -1){
		// everyone has passed
		everyonePassed = true;
	}
	
	if (everyonePassed){
		handleEveryonePass();	// what to do when everyone passes
	}
	// alert the next player to make a move
	alertNextPlayer();
}


// rules
function checkRules(hand){
	// check not the first move of the game
	if (gameState["moves"] == 0){
		var lowestCard = usersHash[gameState["currentPlayer"]]["hand"][0];
		if (threeOfClubsDealt() && !hasThreeOfClubs(hand)){
			// if there are 0 moves and 3C was dealt but it wasn't played in the hand, this violates the rule
			return false;
		}
		else if (hand.indexOf(lowestCard) == -1){
			// if hand does not contain lowest card played
			return false;
		}
	}
	
	// check that the hand submitted is in the currentPlayers hand...
	var currentPlayerHand = usersHash[gameState["currentPlayer"]]["hand"];
	hand.forEach(function(card){
		if (currentPlayerHand.indexOf(card) == -1){
			// this player submitted a hand that was not in his real hand
			return false;
		}
	});
	
	// check if clean slate
	if (gameState["currentPlaySize"] == null){
		// clean slate, check valid hand
		if (hasValidLength(hand)){
			// hand is valid length, so check combo:
			if (isValidCombo(hand)){
				// hand is valid combo, init gamestate vars
				gameState["currentPlaySize"] = hand.length;
				gameState["currentPlayHistory"].push(hand);
				gameState["moves"] += 1;	
				return true;
			}
			else{
				console.log("this is not a valid combo!");
			}
		}
		else{
			console.log("this is not a valid hand length");
		}
		console.log(gameState);
	}
	else{
		// there was a hand played before this
		// first check valid length of hand?
		if (hasValidLength(hand)){
			// hand is valid length
			if (isValidCombo(hand)){
				// hand is a valid combo
				var currentPlayHistory = gameState["currentPlayHistory"];
				var prevHand = currentPlayHistory[currentPlayHistory.length - 1];
				var compare = compareToHand(prevHand, hand);
				if (compare != 1){
					return false;
				}
				// valid hand, so update game state
				gameState["currentPlayHistory"].push(hand);
				gameState["moves"] += 1;
				return true;
			}
			else{
				console.log("not a valid combo");
			}
		}
		else{
			console.log("not a valid length");
		}
	}
	return false;
}

function threeOfClubsDealt(){
	var playerIds = getPlayerIds();
	playerIds.forEach(function(clientId){
		if (usersHash[clientId]["hand"].indexOf("3C") > -1){
			return true;
		}
	});
	return false;
}

function hasThreeOfClubs(hand){
	return (hand.indexOf("3C") > -1);
}

function hasValidLength(hand){
	return ([1,2,5].indexOf(hand.length) > -1);
}

function isValidCombo(hand){
	switch (hand.length){
		case 1:
			return true;
		case 2:
			return (getValue(hand[0]) == getValue(hand[1]));
		case 5:
			return (isStraight(hand) || isFullHouse(hand) || isFourKind(hand));
		default:
			return false;
	}
}

function compareToHand(prevHand, newHand){
	if (prevHand.length != newHand.length || !hasValidLength(newHand)){
		return false;
	}
	// hands should be equal and valid length by here, just exploit getHandValue(hand)
	if (gameState["jackCounter"] == 0){
		if (getHandValue(newHand) > getHandValue(prevHand)){
			return 1;
		}
		else{
			return -1;
		}
	}
	else {
		// there is a jack, so return 1 if the new hand is lower
		if (getHandValue(newHand) < getHandValue(prevHand)){
			return 1;
		}
		else{
			return -1;
		}
	}
}

function getHandValue(hand){
	var sum = 0;
	switch (hand.length){
		case 1:
			sum = getValue(hand[0]);
			break;
		case 2:
			hand.forEach(function(card){
				sum += getValue(card);
			});
			break;
		case 5:
			if (isStraight(hand)){
				sum = getStraightValue(hand);
			}
			else if (isFullHouse(hand)){
				sum = 100 + getTripletValue(hand);
			}
			else if (isFourKind(hand)){
				sum = 1000 + getFourKindValue(hand);
			}
			break;
		default:
			sum = -1;
			break;
	}
	console.log("the sum of this hand is "+sum);
	return sum;
}

function getTripletValue(hand){
	var tempHash = {};
	var tempValue;
	hand.forEach(function(card){
		tempValue = getValue(card);
		if (tempValue in tempHash){
			tempHash[tempValue] += 1;
		}
		else{
			tempHash[tempValue] = 1;
		}
	});
	if (Object.size(tempHash) == 2){
		var countsArr = [];
		for (var card in tempHash){
			if (tempHash[card] == 3){
				return 3*parseInt(card);
			}
		}
	}
}

function getStraightValue(hand){
	var sum = 0;
	hand.forEach(function(card){
		sum += getValue(card);
	});
	return sum;
}

function getFourKindValue(hand){
	var tempHash = {};
	var tempValue;
	hand.forEach(function(card){
		tempValue = getValue(card);
		if (tempValue in tempHash){
			tempHash[tempValue] += 1;
		}
		else{
			tempHash[tempValue] = 1;
		}
	});
	if (Object.size(tempHash) == 2){
		var countsArr = [];
		for (var card in tempHash){
			if (tempHash[card] == 4){
				return 4*parseInt(card);
			}
		}
	}
}

function isStraight(hand){
	if ( (getValue(hand[0]) == getValue(hand[1]) - 1) 
	&& (getValue(hand[0]) == getValue(hand[2]) - 2)
	&& (getValue(hand[0]) == getValue(hand[3]) - 3)
	&& (getValue(hand[0]) == getValue(hand[4]) - 4) ){
		return true;
	}
	return false;
}

function isFullHouse(hand){
	var tempHash = {};
	var tempValue;
	hand.forEach(function(card){
		tempValue = getValue(card);
		if (tempValue in tempHash){
			tempHash[tempValue] += 1;
		}
		else{
			tempHash[tempValue] = 1;
		}
	});
	console.log(tempHash);
	if (Object.size(tempHash) == 2){
		var countsArr = [];
		for (var card in tempHash){
			countsArr.push(tempHash[card]);
		}
		if ( (countsArr[0] == 2 && countsArr[1] == 3) || (countsArr[0] == 3 && countsArr[1] == 2) ){
			return true;
		}
	}
	return false;
}

function isFourKind(hand){
	var tempHash = {};
	var tempValue;
	hand.forEach(function(card){
		tempValue = getValue(card);
		if (tempValue in tempHash){
			tempHash[tempValue] += 1;
		}
		else{
			tempHash[tempValue] = 1;
		}
	});
	if (Object.size(tempHash) == 2){
		var countsArr = [];
		for (var card in tempHash){
			countsArr.push(tempHash[card]);
		}
		if ( (countsArr[0] == 1 && countsArr[1] == 4) || (countsArr[0] == 4 && countsArr[1] == 1) ){
			return true;
		}
		console.log(countsArr);
	}
	return false;
}

function sortHand(hand){
	sortedHand = hand.sort(cardSortFunction);
	return sortedHand;
}

function cardSortFunction(card1, card2){
	return (getValueWithSuit(card1) - getValueWithSuit(card2)); 
}

function getValueWithSuit(card){
	var value;
	if (card.length == 3){
		value = 10;
		if (card[2] == "C"){
			value += .1;
		}
		else if (card[2] == "D"){
			value += .2;
		}
		else if (card[2] == "H"){
			value += .3;
		}
		else if (card[2] == "S"){
			value += .4;
		}
	}
	else{
		switch (card[0]){
			case '2':
				value = 15;
				break;
			case 'A':
				value = 14;
				break;
			case 'K':
				value = 13;
				break;
			case 'Q':
				value = 12;
				break;
			case 'J':
				value = 11;
				break;
			default:
				value = parseInt(card[0]);
				break;
		}
		if (card[1] == "C"){
			value += .1;
		}
		else if (card[1] == "D"){
			value += .2;
		}
		else if (card[1] == "H"){
			value += .3;
		}
		else if (card[1] == "S"){
			value += .4;
		}
	}
	return value;
}
function getValue(card){
	var value;
	if (card.length == 3){
		value = 10;
	}
	else{
		switch (card[0]){
			case '2':
				value = 15;
				break;
			case 'A':
				value = 14;
				break;
			case 'K':
				value = 13;
				break;
			case 'Q':
				value = 12;
				break;
			case 'J':
				value = 11;
				break;
			default:
				value = parseInt(card[0]);
				break;
		}
	}
	return value;
}

function getPlayerIds() {
	// returns ids of players who are still connected (does not include leavers)
	var playerIds = [];
	for (var key in usersHash){
		if (usersHash[key]["type"] == "Player"){
			playerIds.push(key);
		}
	}
	return playerIds;
}
function getObserverIds() {
	var observerIds = [];
	for (var key in usersHash){
		if (usersHash[key]["type"] == "Observer"){
			observerIds.push(key);
		}
	}
	return observerIds;
}
function getNumPlayers() {
	var numPlayers = 0;
	for (var key in usersHash){
		if (usersHash[key]["type"] == "Player"){
			numPlayers++;
		}
	}
	return numPlayers;
}

// chat, nickname functions
everyone.now.submitChat = function(message) {
	// when a user submits chat message
	var text = encodeHTML(message);
	
	if (text.substring(0,4) == "/me ") {
		type = "emote";
		text = text.substring(4);
	}
	else {
		type = "chat";
	}
	var clientId = this.user.clientId;
	var clientName = getPlayerName(clientId);
	var userInfo = {"id": clientId, "name": clientName};
	var messageHash = {"userInfo": userInfo, "type": type, "text": text}
	
	everyone.now.updateChat(messageHash);
}
everyone.now.submitNickname = function(name) {
	// when someone submits new nickname, sanitize and check for uniqueness
	var cleanName = encodeHTML(name);
	for (var clientId in usersHash){
		if (usersHash[clientId]["name"] == cleanName){
			return;
		}
	}
	// name is unique, update entry for client in usersHash
	var clientId = this.user.clientId;
	usersHash[clientId]["name"] = cleanName;
	this.now.name = cleanName;
	// call updateName
	updateName();
	// update the scoreboard (because scoreboard has names)
	everyone.now.updateScoreboard(usersHash);
}
function updateName() {
	// update the names only if a game is going on, otherwise we just see names and no cards...
	if (gameState["isPlaying"] == true){
		var playerIds = gameState["players"];
		var numPlayers = playerIds.length;

		playerIds.forEach(function(clientId){
			// for each player...update their client side
			if (usersHash[clientId] != undefined){
				nowjs.getClient(clientId, function(){
					// deal other players hands
					var myPlayerIndex = playerIds.indexOf(clientId);
					var playerIndex = 0;
					for (var i = myPlayerIndex + 1; i < myPlayerIndex + numPlayers; i++){
						var otherPlayerId = playerIds[i%numPlayers];
						if (usersHash[otherPlayerId] != undefined){
							var playerName = usersHash[otherPlayerId]["name"];	
							this.now.showPlayerName(playerIndex, playerName, otherPlayerId, numPlayers);
						}
						playerIndex++;
					}
				});
			}
		});
	}
}

// ******************** deck functions ********************
function initDeck() {
	deck = ["AC", "2C", "3C", "4C", "5C", "6C", "7C", "8C", "9C", "10C", "JC", "QC", "KC",
			"AD", "2D", "3D", "4D", "5D", "6D", "7D", "8D", "9D", "10D", "JD", "QD", "KD",
			"AH", "2H", "3H", "4H", "5H", "6H", "7H", "8H", "9H", "10H", "JH", "QH", "KH",
			"AS", "2S", "3S", "4S", "5S", "6S", "7S", "8S", "9S", "10S", "JS", "QS", "KS"];
}
function shuffleCards(cards) {	// duh
	var numCards = cards.length;
	var tempCard, randomIndex;
	var numShuffles = 3;
	for (var i = 0; i < numShuffles; i++){
		for (var j = 0; j < numCards; j++){
			randomIndex = Math.floor(Math.random()*numCards);
			tempCard = cards[j];
			cards[j] = cards[randomIndex];
			cards[randomIndex] = tempCard;
		}
	}	
	return cards;
}

// ******************** helper functions ********************
Object.size = function(obj) {
    var size = 0, key;
    for (key in obj) {
        if (obj.hasOwnProperty(key)) size++;
    }
    return size;
};
Array.prototype.flatten = function flatten() {
   var flat = [];
   for (var i = 0, l = this.length; i < l; i++){
       var type = Object.prototype.toString.call(this[i]).split(' ').pop().split(']').shift().toLowerCase();
       if (type) { flat = flat.concat(/^(array|collection|arguments|object)$/.test(type) ? flatten.call(this[i]) : this[i]); }
   }
   return flat;
};
function encodeHTML(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}