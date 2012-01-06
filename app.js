
/**
 * Module dependencies.
 */

var express = require('express'),
	routes = require('./routes'),
	everyauth = require('everyauth'),
	util = require('util'),
	Promise = everyauth.Promise,
	couchUsers = require('./lib/users'),
	couchRooms = require('./lib/rooms');
	
var app = module.exports = express.createServer();
everyauth.helpExpress(app);

everyauth.facebook
// for production
  .appId("327404897281280")
  .appSecret("4065f1bfcdc07f8622a559673a5a1587")
// for staging
	// .appId("284941081554522")
	// .appSecret("d071d228c117bd5f6c6cb18ff896d09d")
	
  // .logoutPath('/logout')
  // .logoutRedirectPath('/')
  .handleAuthCallbackError( function (req, res) {
    //Define here for routing in case user decline app     
  })
  .findOrCreateUser( function (session, accessToken, accessTokExtra, fbUserMetadata) {
	var promise = new Promise();
	couchUsers.findOrCreateByFacebookData(fbUserMetadata, promise, sessionStore, session);
	return promise;
  })
  .redirectPath('/lobby');

var nowjs = require('now');
var connectedFbIds = [];

// Configuration

app.configure(function(){
  app.set('views', __dirname + '/views');
  app.set('view engine', 'ejs');
  app.use(express.bodyParser());
  app.use(express.cookieParser());
  app.use(express.methodOverride());
  app.use(express.session({secret: "jabysybaj"}));
  app.use(everyauth.middleware());
  app.use(app.router);
  app.use(express.static(__dirname + '/public'));
});

app.configure('development', function(){
  app.use(express.errorHandler({ dumpExceptions: true, showStack: true })); 
});

app.configure('production', function(){
  app.use(express.errorHandler()); 
});

everyauth.helpExpress(app);

// Routes

var sessionStore = {};

function sessionExists(sessionID){
	for (var sessionId in sessionStore){
		if (sessionId == sessionID){
			return true;
		}
	}
	return false;
}

function addToSessionStore(request){
	// session doesnt store sessionID...
	request.session.sessionId = request.sessionID;
	request.session.clientId = -1;
	// store session in sessionStore, with key = sessionID
	sessionStore[request.sessionID] = request.session;
	console.log("sessionStore with key " + request.sessionID + " was added at " + new Date());
}

function setClientId(sessionID, clientId){
	console.log("setting client id at " + new Date());
	sessionStore[sessionID].clientId = clientId;
	return clientId;
}

function beforeFilterSession(request){
	if (sessionExists(request.sessionID)){
		console.log("session exists");
		// user session not stored in userSessions, so store
	}
	else{
		console.log("adding to sessionStore");
		addToSessionStore(request);
	}
	setPath(request);
}

function setPath(request){
	// update the path var for session
	var path = request.route.path;
	console.log("path = "+path);
	sessionStore[request.sessionID].path = path;
	console.log("session store for this session = ");
	console.log(sessionStore[request.sessionID]);
}

app.get('/', function(req, res){
	beforeFilterSession(req);
	var myRooms = rooms;
	if (req.session.auth == undefined){
		// for anonymous users
		res.render('index');
	}
	else if (req.session.auth != undefined){
		// logged in with fb already, so redirect to lobby
		res.redirect('/lobby');
	}
});

app.get('/lobby', function(req, res){
	beforeFilterSession(req);
	var myRooms = rooms;
	
	var mySession = sessionStore[req.sessionID];
	// get rooms
	// var rooms = couchRooms.findAllRooms();
	console.log(req.route.path);
	res.render('lobby', {sess: mySession, myRooms: myRooms});
});

app.get('/game/:id', function(req, res){
	beforeFilterSession(req);
	var roomId = req.params.id;
	if (roomId < 1 || roomId > 5){
		res.redirect('lobby');
	}
	else {
		console.log("AWEOFIJAWEOFIJAWOEFIJ");
		if (req.session.auth == undefined){
			// playing as anon, set room id
			sessionStore[req.sessionID].roomId = roomId;
			console.log("updated room id to "+sessionStore[req.sessionID].roomId);
			res.render('game');
		}
		else if (connectedFbIds.indexOf(req.session.auth.userId) > -1){
			// player is already connected, redirect to index
			res.redirect('index');
		}
		else{
			// playing as fb user
			connectedFbIds.push(req.session.auth.userId);
			// set room id
			sessionStore[req.sessionID].roomId = roomId;
			res.render('game');
		}
	}
});
// 
// app.get('/game/:room_id', function(req, res){
// 	
// })

app.post('/lobby', function(req, res){
	var room = req.body.room;
	req.session.room = room;
	res.redirect('/lobby');
});

app.get('/rules', function(req, res){
	res.render('rules');
});

app.listen(3000);
console.log("Express server listening on port %d in %s mode", app.address().port, app.settings.env);
var everyone = nowjs.initialize(app);

var rooms = [];

function initializeRooms(numRooms){
	for (var i = 0; i < numRooms; i++){
		var roomObj = new Object();
		roomObj.roomId = (i+1);
		roomObj.usersHash = {};
		roomObj.anonId = 1;
		roomObj.observerId = 1;
		roomObj.deck = [];
		roomObj.maxPlayers = 4;
		roomObj.gameState = {"isPlaying": false, "currentPlayer": 0, "players": [], "currentPlaySize": null, "currentPlayHistory": [], "discardPile": [], "moves": 0, "activePlayers": [], "places": [], "moveBits": [], "jackCounter": 0, "passNum": 0, "discardNum": 0};
		roomObj.waitingPlayers = [];
		rooms.push(roomObj);
	}
}

initializeRooms(3);

function getGameState(nowUserObj){
	var clientSession = getClientSession(nowUserObj);
	var roomId = clientSession.roomId;
	var gameState = rooms[roomId].gameState;
	return gameState;
}

var connections = {};

function updateClientId(nowUserObj){
	var clientSessionId = unescape(nowUserObj.cookie["connect.sid"]);
 	var clientId = setClientId(clientSessionId, nowUserObj.clientId);
	return clientId;
}

function getClientSession(nowUserObj){
	var clientSessionId = unescape(nowUserObj.cookie["connect.sid"]);
	var clientSession = sessionStore[clientSessionId];
	return clientSession;
}

// when a client connects
nowjs.on('connect', function() {
	// whenever someone connects, they get a new clientId, so update the clientId
	var clientId = updateClientId(this.user);
	var clientSession = getClientSession(this.user);
	
	
	console.log("Connecting at " + (new Date()));
	// check the path to figure out where they're connecting to, as well as their state
	if (clientSession.path.substring(0,5) == "/game" && clientSession.state != "game" && clientSession.roomId != -1){
		// if they're trying to access /game and their state is not "game", 
		// then set their state to "game"
		clientSession.state = "game";
		// client is in a game, so get room object
		var roomId = clientSession.roomId;
		var room = rooms[roomId - 1];
		
		console.log("room id = " + roomId + " and room = "+room);
		// setting up clientData
		var clientData = clientSession.doc;
		if (clientData != undefined) {	
			// client is logged in with fb
			var score = clientData.score;
			var wins = clientData.wins;
			var name = clientData.name.split(" ")[0];
			var facebookId = clientData.facebookId;
			var numGames = clientData.numGames;
		}
		else {
			var score = 0;
			var wins = 0;
			var name = "anon"+room.anonId;
			var facebookId = 0;
			var numGames = 0;
			room.anonId += 1;
		}
		var gameState = room.gameState;
		var usersHash = room.usersHash;
		var waitingPlayers = room.waitingPlayers;
		
		var userType = ((gameState["isPlaying"] || getNumPlayers(room) == 4) ? "Observer": "Player");
		this.now.name = name;
		usersHash[clientId] = {"id": clientId, "name": name, "type": userType, "score": score, "wins": wins, "hand": [], "color": "#000000", "fbid": facebookId, "numGames": numGames};
		var roomClients = getRoomClients(room);
		
		console.log("********** A user has connected **********");
		console.log(usersHash[clientId]);
		console.log("******************************************");
		// populate the nickname input
		this.now.populateNickname(name);

		if (userType == "Observer"){
			initObserverView(clientId, room);
			waitingPlayers.push(clientId);
		}
		assignUniqueColor(clientId, room);

		// update the chat
		broadcastJoin(clientId, room);
		// update the scoreboard
		roomClients.forEach(function(clientId){
			nowjs.getClient(clientId, function(){
				this.now.updateScoreboard(usersHash);
			});
		});

		// show players start button
		if (getNumPlayers(room) > 1 && !gameState["isPlaying"]){
			var playerIds = getPlayerIds(room);
			// show players the start button
			playerIds.forEach(function(playerId){
				nowjs.getClient(playerId, function(){
					this.now.showStartButton();
					this.now.removeWaitForGame();
					this.now.removeGameOverButton();
				});
			});
		}
		else if (getNumPlayers(room) == 1){
			// show players the wait for game
			roomClients.forEach(function(clientId){
				nowjs.getClient(clientId, function(){
					this.now.showWaitForGame();
				});
			});
		}
		
		console.log("*********** Users hash ************* ");
		console.log(usersHash);
		console.log("************************************ ");
		
		// someone joined this room, update lobby
		updateLobbyClientCount(room);
	}
});

function savePlayerStats(clientId, room){
	var usersHash = room.usersHash;
	var facebookId = usersHash[clientId]["fbid"];
	if (facebookId > 0){
		var newWins = parseInt(usersHash[clientId]["wins"]);
		var newScore = parseInt(usersHash[clientId]["score"]);
		var newNumGames = parseInt(usersHash[clientId]["numGames"]);
		couchUsers.updateData(facebookId, newScore, newWins, newNumGames);
	}
}

// when a client disconnects
nowjs.on('disconnect', function() {
	var clientId = updateClientId(this.user);
	var clientSession = getClientSession(this.user);
	
	console.log("At disconnect, the state is " + clientSession.state);
	if (clientSession.state == "game"){
		// if they were in a game, change their state to lobby		
		var oldRoom = rooms[clientSession.roomId - 1];
		var gameState = oldRoom.gameState;
		var usersHash = oldRoom.usersHash;
		clientSession.state = "lobby";
		clientSession.roomId = -1;
		if (clientSession.doc != undefined){
			// if they logged in via fb, remove them from array of logged in fb users.
			connectedFbIds.splice(connectedFbIds.indexOf(usersHash[clientId]["fbid"]), 1);
		}
		
		// their previous state was in a game.
		if (Object.size(usersHash) > 1) {
			// continue if there's still someone connected to the server
			console.log("user is disconnecting, but there is still someone connected to server");
			// update chat
			console.log("updating the chat");
			broadcastLeave(clientId, oldRoom);
			console.log("chat shouldve been updated. " + clientId + " left");
			
			var playerIndex = gameState["players"].indexOf(clientId);
			if (playerIndex > -1) {
				console.log("removing player "+clientId+" and his index is "+playerIndex);
				// remove cards from the FRONTEND
				updatePlayerHand(usersHash[clientId]["hand"], clientId, "remove", oldRoom);
				// update moveBits
				gameState["moveBits"][playerIndex] = -1

				if (gameState["activePlayers"].indexOf(clientId) > -1) {
					// player was active. splice him (and don't place him)
					gameState["activePlayers"].splice(gameState["activePlayers"].indexOf(clientId), 1);
					// update leaver score. since he was active, isWinner = false
					preparePlayerStats(clientId, false, true, oldRoom);

					if (gameState["activePlayers"].length == 1){
						// number of active players went from 2 to 1, so update the player that's left's score
						// if no one has been placed, then he is the winner
						var remainingActivePlayer = gameState["activePlayers"][0];
						preparePlayerStats(remainingActivePlayer, gameState["places"].length == 0, false, oldRoom);
					}
				}
				else{
					// player is not active, already played all of his cards
					// his score should've already been updated
				}

				if (gameState["activePlayers"].length > 1){
					if (gameState["currentPlayer"] == clientId) {
						alertNextPlayer(oldRoom);
					}
				}

				// check game over to broadcast
				checkGameOver(oldRoom);
			}
			// delete user from the server
			delete usersHash[clientId];

			// update scoreboard
			var roomClients = getRoomClients(oldRoom);
			roomClients.forEach(function(clientId){
				nowjs.getClient(clientId, function(){
					this.now.updateScoreboard(usersHash);
				});
			});
			
			if (gameState["isPlaying"] == false && Object.size(usersHash) < 2) {
				// hide the start button
				roomClients.forEach(function(clientId){
					nowjs.getClient(clientId, function(){
						this.now.removeStartButton();
						this.now.showWaitForGame();
					});
				});
			}
		}
		else{
			console.log("user is disconnecting, and no one else is connected to server");
			delete usersHash[clientId];
		}
		// someone left the room, update lobby
		updateLobbyClientCount(oldRoom);
	}
});

function updateLobbyClientCount(room){
	var lobbyClientIds = getLobbyClients();
	var playerIds = getPlayerIds(room);
	
	console.log("lobby clients = " + lobbyClientIds);
	lobbyClientIds.forEach(function(clientId){
		nowjs.getClient(clientId, function(){
			this.now.updateClientCount(room.roomId, playerIds.length);
		});
	});
}

everyone.now.waitForGame = function(){
	var clientSession = getClientSession(this.user);
	var roomId = clientSession.roomId;
	
	var room = rooms[roomId - 1];
	var playerIds = getPlayerIds(room);
	var numPlayers = playerIds.length;
	var roomClients = getRoomClients(room);
	
	roomClients.forEach(function(clientId){
		nowjs.getClient(clientId, function(){
			this.now.removeGameOverButton();
			if (numPlayers > 1){
				// tell everyone to init game
				this.now.removeWaitForGame();
				this.now.showStartButton();
			}
			else{
				this.now.showWaitForGame();
			}
		});
	});
}

// called when anyone on client side presses start game button
everyone.now.initGame = function(){
	var clientSession = getClientSession(this.user);
	var roomId = clientSession.roomId;
	var room = rooms[roomId - 1];
	var gameState = room.gameState;
	var roomClients = getRoomClients(room);
	var usersHash = room.usersHash;
	var waitingPlayers = room.waitingPlayers;
	
	// check to make sure gameState isPlaying is really false in case of concurrency issues?
	if (!gameState["isPlaying"]){
		resetGameState(room);
		room.gameState["isPlaying"] = true;		// we are now playing...
	
		// hide the start button for all clients
		roomClients.forEach(function(clientId){
			nowjs.getClient(clientId, function(){
				this.now.removeStartButton();
				this.now.removeGameOverButton();
				this.now.removeWaitForGame();
				this.now.clearStage();
				this.now.clearDiscardPile();
				this.now.clearSlots();
			});
		});
		
		// if there are any waiting players, make sure they get taken off the queue and get assigned as players:
		var playerIds = getPlayerIds(room);
		var numPlayers = playerIds.length;
		if (numPlayers < 4 && waitingPlayers.length > 0){
			var freeSeats = 4 - numPlayers;
			var playersToAdd = Math.min(freeSeats, waitingPlayers.length);
			for (var i = 0; i < playersToAdd; i++){
				var clientId = waitingPlayers.shift();	// remove first in line from waitingPlayers
				usersHash[clientId]["type"] = "Player";	// assign as player
			}
		}
		
		roomClients.forEach(function(clientId){
			nowjs.getClient(clientId, function(){
				this.now.updateScoreboard(usersHash);
			});
		});
		
		initDeck(room);							// initialize the deck
		shuffleCards(room);			// shuffle cards in room
		
		updateNumGamesPlayed(room);				// increment all player's numGames
		assignHands(room);						// assigns each players hand on the backend
		dealPlayerHands(room);					// deals each players hand on the frontend
		
		// init observer view
		var observerIds = getObserverIds(room);
		observerIds.forEach(function(clientId){
			initObserverView(clientId);
		});
		
		beginPlaying(room);						// start taking turns
	}
}

function updateNumGamesPlayed(room){
	var usersHash = room.usersHash;
	var playerIds = getPlayerIds(room);
	playerIds.forEach(function(playerId){
		usersHash[playerId]["numGames"] += 1;
	});
}

function getRoomClients(room){
	var usersHash = room.usersHash;
	var clientIds = [];
	for (var clientId in usersHash){
		clientIds.push(clientId);
	}
	return clientIds;
}

function broadcastJoin(clientId, room){
	// update the chat
	var usersHash = room.usersHash;
	
	var name = getPlayerName(clientId, room);
	var text = " is here.";
	var userInfo = {"id": clientId, "name": name};
	var messageHash = {"userInfo": userInfo, "type": "emote", "text": text}
	var color = usersHash[clientId]["color"];
	
	var clientIds = getRoomClients(room);
	clientIds.forEach(function(clientId){
		nowjs.getClient(clientId, function(){
			this.now.updateChat(messageHash, color);
		});
	});
}

function broadcastLeave(clientId, room){
	usersHash = room.usersHash;
	
	var name = getPlayerName(clientId, room);
	if (name != null){
		var text = " left.";
		var userInfo = {"id": clientId, "name": name};
		var messageHash = {"userInfo": userInfo, "type": "emote", "text": text}
		var color = usersHash[clientId]["color"];
	}
	
	var clientIds = getRoomClients(room);
	clientIds.forEach(function(clientId){
		nowjs.getClient(clientId, function(){
			this.now.updateChat(messageHash, color);
		});
	});
}

function initObserverView(clientId, room){
	var playerIds = getPlayerIds(room);		// get array of player ids
	var numPlayers = playerIds.length;	// get number of players
	
	var usersHash = room.usersHash;
	var gameState = room.gameState;
	
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
	
	// set the stage
	var currentPlayHistory = gameState["currentPlayHistory"];
	currentPlayHistory.forEach(function(hand){
		nowjs.getClient(clientId, function(){
			this.now.addToCurrentPlay(hand);
		});
	});
	
	// set the discard pile
	var numDiscarded = gameState["discardPile"].length;
	nowjs.getClient(clientId, function(){
		this.now.addToDiscardPile(numDiscarded);
	});
}

// assign each players hands on the server side
function assignHands(room){
	var numPlayers = getNumPlayers(room);		// we need to get number of players for later...
	var playerIds = getPlayerIds(room);			// and each player's ids
	console.log("Player ids:" + playerIds);
	var usersHash = room.usersHash;
	var deck = room.deck;
	
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

function updatePlayerHand(cards, playerId, type, room){
	var gameState = room.gameState;
	var usersHash = room.usersHash;
	// cards 	= cards to add/remove
	// playerId = player's hand to modify
	// type 	= add/remove
	
	// update playerId's frontend
	nowjs.getClient(playerId, function(){
		if (type == "remove"){
			this.now.removeFromPersonalHand(cards);
		}
		else{
			console.log("adding to personal hand: " + cards);
			this.now.addToPersonalHand(cards);
		}
	});
	
	// update everyone elses view of the player's hand, including observers' view
	var playerIds = gameState["players"];		// get array of player ids
	var numPlayers = playerIds.length;			// get number of players in the game (leavers, finishers included)
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
				if (type == "remove"){
					this.now.removeFromOtherHand(cards.length, relativeIndex, numPlayers);	
				}
				else{
					this.now.addToOtherHand(cards.length, relativeIndex, numPlayers);	
				}
			});
		}
	}
	
	var observerIds = getObserverIds(room);
	observerIds.forEach(function(observerId){
		// for each observer, update their view of the player's hand
		nowjs.getClient(observerId, function(){
			if (type == "remove"){
				this.now.removeFromOtherHand(cards.length, relativeIndex, numPlayers);	
			}
			else{
				this.now.addToOtherHand(cards.length, relativeIndex, numPlayers);	
			}
		});
	});
}

// loops through all players and deals their hands on the client side, also shows their names
function dealPlayerHands(room){
	var numPlayers = getNumPlayers(room);
	var playerIds = getPlayerIds(room);
	var usersHash = room.usersHash;
	
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
function getStartingPlayer(playerIds, room){
	var startingPlayerId;
	var minCardValue = 99;
	var tempValue;
	var usersHash = room.usersHash;
	
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
function beginPlaying(room){
	// figure out starting player
	var playerIds = getPlayerIds(room);
	var usersHash = room.usersHash;
	var gameState = room.gameState;
	var roomClients = getRoomClients(room);
	
	var startingPlayerId = getStartingPlayer(playerIds, room);
	var playerName = usersHash[startingPlayerId]["name"];
	
	// set gameState vars
	playerIds.forEach(function(playerId){
		gameState["players"].push(playerId);
		gameState["activePlayers"].push(playerId);
	});
	gameState["currentPlayer"] = startingPlayerId;
	gameState["moveBits"] = [1,1,1,1].slice(0, playerIds.length);
	
	// starting player must make a move
	roomClients.forEach(function(clientId){
		nowjs.getClient(clientId, function(){
			this.now.showCurrentPlayer(startingPlayerId);
		});
	});
	nowjs.getClient(startingPlayerId, function(){
		this.now.showMakeMoveButton();
	});
}

everyone.now.sendMove = function(hand){
	var clientSession = getClientSession(this.user);
	var roomId = clientSession.roomId;
	var room = rooms[roomId - 1];
	var gameState = room.gameState;
	var usersHash = room.usersHash;
	var roomClients = getRoomClients(room);
	
	if (gameState["passNum"] == 0 && gameState["discardNum"] == 0){
		hand = sortHand(hand);
		if (checkRules(hand, room)){
			// valid hand, game state should've already been updated
			// set move bits to 1 (more details in function)
			setMoveBitsToOne(room);

			var clientId = this.user.clientId;
			// remove the hand from the player who made the move (BACKEND and FRONTEND)
			removeCardsFromHand(hand, clientId, room);
			// update everyone's view of the stage (FRONTEND)
			roomClients.forEach(function(clientId){
				nowjs.getClient(clientId, function(){
					this.now.addToCurrentPlay(hand);
				});
			});

			// LOGISTICS
			// check for 5's, draw if hand not empty
			if (usersHash[clientId]["hand"].length > 0){
				checkForFives(hand, clientId, room);
			}
			// check for J's
			checkForJacks(hand, room);
			
			// check if the player who just played now has an empty hand
			checkEmptyHand(clientId, room);
			
			if (gameState["isPlaying"]){
				if (checkForSevens(hand, clientId, room)){
					// if there are sevens, handle all send move actions later
				}
				else if (checkForTens(hand, clientId, room)){
					// if there are tens, handle all send move actions later
				}
				else{
					if (containsEight(hand) || threesOverJacks(hand) || fourThreesOneJack(hand)){
						console.log("passing everyone");
						passEveryone(room);
						resetJackCounter(room);
					}
					else{
						console.log("alerting next player 1");
						alertNextPlayer(room);
					}
					updateJackCounter(room);
					notifyJackInPlay(room);
				}
			}
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
			notifyJackInPlay(room);
		}
	}
	
	else if (gameState["passNum"] > 0){
		// we get here from playing 7s
		var cardsToPass = hand;
		if (cardsToPass.length < gameState["passNum"] || cardsToPass.length > gameState["passNum"]){
			var message = "<~ Read";
			this.now.showErrorMessage(message);
			// show make move button again
			this.now.showMakeMoveButton();
			// show the pass message again
			this.now.notifyPassCards(gameState["passNum"]);
		}
		else{
			var clientId = this.user.clientId;
			var nextPlayerId = getNextPlayer(room);
			addCardsToHand(cardsToPass, nextPlayerId, room);
			removeCardsFromHand(cardsToPass, clientId, room);
			gameState["passNum"] = 0;
			
			checkEmptyHand(clientId, room);
			
			if (gameState["isPlaying"]){
				var currentPlayHistory = gameState["currentPlayHistory"];
				var playedHand = currentPlayHistory[currentPlayHistory.length - 1];

				if (checkForTens(playedHand, clientId, room)){
					// this guy played tens, handle send move actions later
				}
				else{
					if (containsEight(playedHand) || threesOverJacks(playedHand) || fourThreesOneJack(playedHand)){
						console.log("passing everyone");
						passEveryone(room);
						resetJackCounter(room);
					}
					else{
						console.log("alerting next player 2");
						alertNextPlayer(room);
					}
					updateJackCounter(room);
					notifyJackInPlay(room);
				}
			}
		}
	}
	
	else if (gameState["discardNum"] > 0){
		var cardsToDiscard = hand;
		if (cardsToDiscard.length < gameState["discardNum"] || cardsToDiscard.length > gameState["discardNum"]){
			var message = "<~ Read";
			this.now.showErrorMessage(message);
			// show make move button again
			this.now.showMakeMoveButton();
			// show the pass message again
			this.now.notifyDiscardCards(gameState["discardNum"]);
		}
		else{
			var clientId = this.user.clientId;
			removeCardsFromHand(cardsToDiscard, clientId, room);
			
			roomClients.forEach(function(clientId){
				nowjs.getClient(clientId, function(){
					this.now.addToDiscardPile(cardsToDiscard.length);
				})
			})
			gameState["discardNum"] = 0;
			
			checkEmptyHand(clientId, room);
			
			if (gameState["isPlaying"]){
				var currentPlayHistory = gameState["currentPlayHistory"];
				var playedHand = currentPlayHistory[currentPlayHistory.length - 1];
				if (containsEight(playedHand) || threesOverJacks(playedHand) || fourThreesOneJack(playedHand)){
					console.log("passing everyone");
					passEveryone(room);
					resetJackCounter(room);
				}
				else{
					console.log("alerting next player 3");
					alertNextPlayer(room);
				}
				updateJackCounter(room);
				notifyJackInPlay(room);
			}
		}
	}
}

function updateJackCounter(room){
	var gameState = room.gameState;
	if (gameState["jackCounter"] > 0){
		gameState["jackCounter"] -= 1;
	}
}

function resetJackCounter(room){
	var gameState = room.gameState;
	gameState["jackCounter"] = 0;
}

function checkForFives(hand, clientId, room){
	var gameState = room.gameState;
	var numFives = 0;
	for (var i = 0; i < hand.length; i++){
		var card = hand[i];
		if (card[0] == "5"){
			numFives++;
		}
	}
	console.log("numfives = "+numFives);
	// drawing X cards from discard pile
	var numDiscard = gameState["discardPile"].length;
	var cardsToAdd = [];
	for (var i = 0; i < Math.min(numFives, numDiscard); i++){
		var randomCard = gameState["discardPile"].splice(Math.random()*gameState["discardPile"].length, 1);
		cardsToAdd.push(randomCard);
	}
	cardsToAdd = cardsToAdd.flatten();
	
	// if cards are present, add cards to hand and remove from discard pile
	if (cardsToAdd.length > 0){
		var roomClients = getRoomClients(room);
		addCardsToHand(cardsToAdd, clientId, room);
		roomClients.forEach(function(clientId){
			nowjs.getClient(clientId, function(){
				this.now.removeFromDiscardPile(cardsToAdd.length);
			});
		});
	}
}

function threesOverJacks(hand){
	if (isFullHouse(hand) && hand[0][0] == '3' && hand[1][0] == '3' && hand[2][0] == '3' && hand[3][0] == 'J' && hand[4][0] == 'J'){
		return true;
	}
	return false;
}

function fourThreesOneJack(hand){
	if (isFourKind(hand) && hand[0][0] == '3' && hand[1][0] == '3' && hand[2][0] == '3' && hand[3][0] == '3' && hand[4][0] == 'J'){
		return true;
	}
	return false;
}

function addCardsToHand(hand, clientId, room){
	var usersHash = room.usersHash;
	for (var i = 0; i < hand.length; i++){
		var card = hand[i];
		usersHash[clientId]["hand"].push(card);
	}
	sortHand(usersHash[clientId]["hand"]);
	updatePlayerHand(hand, clientId, "add", room);
}

function checkForSevens(hand, clientId, room){
	var usersHash = room.usersHash;
	var gameState = room.gameState;
	
	var numSevens = 0;
	for (var i = 0; i < hand.length; i++){
		var card = hand[i];
		if (card[0] == "7"){
			numSevens++;
		}
	}
	if (numSevens > 0){
		var currentHand = usersHash[clientId]["hand"];
		if (currentHand.length == 0){
			// user need not pass any cards, just alert next player
			alertNextPlayer(room);
		}
		else{
			// if 2 7's were played, but player only has 1 card left, then he only passes 1 card.
			var numCardsToPass = Math.min(currentHand.length, numSevens);
			// set up passNum in the gameState so we know how many cards we expect to receive as input from the player
			gameState["passNum"] = numCardsToPass;
			// alert the player to select cards to pass
			nowjs.getClient(clientId, function(){
				this.now.notifyPassCards(numCardsToPass);
				this.now.showMakeMoveButton();
			});
		}
		return true;
	}
	return false;
}

function checkForTens(hand, clientId, room){
	var usersHash = room.usersHash;
	var gameState = room.gameState;
	var numTens = 0;
	for (var i = 0; i < hand.length; i++){
		var card = hand[i];
		if (card[0] == "1" && card[1] == "0"){
			numTens++;
		}
	}
	if (numTens > 0){
		var currentHand = usersHash[clientId]["hand"];
		console.log("chekcing for tens. hand is "+currentHand);
		if (currentHand.length == 0){
			alertNextPlayer(room);
		}
		else{
			// if 2 10's were played but player only has 1 card left, then he only discards one card
			var numCardsToDiscard = Math.min(currentHand.length, numTens);
			gameState["discardNum"] = numCardsToDiscard;
			// alert the player to select cards to discard
			nowjs.getClient(clientId, function(){
				this.now.notifyDiscardCards(numCardsToDiscard);
				this.now.showMakeMoveButton();
			});
		}
		return true;
	}
	return false;
}

function checkForJacks(hand, room){
	var gameState = room.gameState;
	for (var i = 0; i < hand.length; i++){
		var card = hand[i];
		if (card[0] == "J"){
			gameState["jackCounter"] = gameState["activePlayers"].length;
			break;
		}
	}
}

function containsEight(hand){
	for (var i = 0; i < hand.length; i++){
		var card = hand[i];
		if (card[0] == "8"){
			return true;
		}
	}
	return false;
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

function setMoveBitsToOne(room){
	var gameState = room.gameState;
	// after a send move, find all people with bit != -1 and set it to 1.
	// effectively assumes that everyone can play on that hand
	// also gets called when a round ends (and new round begins), as a reset
	gameState["moveBits"].forEach(function(bit, index){
		if (bit != -1){
			gameState["moveBits"][index] = 1;
		}
	});
}

function checkEmptyHand(clientId, room){
	var usersHash = room.usersHash;
	var gameState = room.gameState;
	// called when a player sends a move
	var tempHand = usersHash[clientId]["hand"];
	var playerIndex = gameState["players"].indexOf(clientId);
	if (tempHand.length == 0){
		console.log("hand is empty for "+clientId);
		var activePlayerIndex = gameState["activePlayers"].indexOf(clientId);
		
		gameState["moveBits"][playerIndex] = -1;		// use -1 to indicate the player is done playing
		
		gameState["activePlayers"].splice(activePlayerIndex, 1);
		gameState["places"].push(clientId);
		
		preparePlayerStats(clientId, gameState["places"].indexOf(clientId) == 0, false, room);
		
		checkGameOver(room);
	}
	else{
		console.log("hand is not empty for "+clientId);
		// set player who just made a move to 2
		gameState["moveBits"][playerIndex] = 2;
	}
}

// game over functions
function checkGameOver(room){
	var gameState = room.gameState;
	if (gameState["activePlayers"].length == 1){
		// if there's only one active player left, then the game is over, so call gameOver		
		gameOver(room);
	}
}

function gameOver(room){
	var gameState = room.gameState;
	// update places
	gameState["places"].push(gameState["activePlayers"].pop());
	gameState["isPlaying"] = false;
	// broadcast game over
	broadcastGameOver(room);
}

function preparePlayerStats(clientId, isWinner, isLeaver, room){
	var usersHash = room.usersHash;
	var roomClients = getRoomClients(room);
	if (isLeaver){
		usersHash[clientId]["score"] -= 10;
	}
	else{
		// if player is winner, update wins
		if (isWinner){
			usersHash[clientId]["wins"] += 1;
		}
		// set this clients score to the number of cards other players have
		var numOtherCards = getNumCardsLeft(room) - usersHash[clientId]["hand"].length;
		usersHash[clientId]["score"] += numOtherCards;
	}
	// update the scoreboard (FRONTEND)
	roomClients.forEach(function(clientId){
		nowjs.getClient(clientId, function(){
			this.now.updateScoreboard(usersHash);
		});
	});
	// update the database (BACKEND)
	savePlayerStats(clientId, room);
}

function getNumCardsLeft(room){
	var usersHash = room.usersHash;
	
	var playerIds = getPlayerIds(room);
	var numCardsLeft = 0;
	playerIds.forEach(function(playerId){
		numCardsLeft += usersHash[playerId]["hand"].length;
	})
	return numCardsLeft;
}

function getLobbyClients(){
	var clientIds = [];
	console.log("current session store:");
	console.log(sessionStore);
	for (var sessionId in sessionStore){
		console.log(sessionStore[sessionId]);
		if (sessionStore[sessionId].path == "/lobby"){
			clientIds.push(sessionStore[sessionId].clientId);
		}
	}
	console.log(clientIds);
	return clientIds;
}

function broadcastGameOver(room){
	// broadcasts to true players (players left in the game)
	var playerIds = getPlayerIds(room);
	playerIds.forEach(function(playerId){
		nowjs.getClient(playerId, function(){
			this.now.handleGameOver();
		});
	});
}

function resetGameState(room){
	room.deck = [];
	room.gameState = {"isPlaying": false, "currentPlayer": 0, "players": [], "currentPlaySize": null, "currentPlayHistory": [], "discardPile": [], "moves": 0, "activePlayers": [], "places": [], "moveBits": [], "jackCounter": 0, "passNum": 0, "discardNum": 0};
}

function getPlayerName(playerId, room){
	var usersHash = room.usersHash;
	if (usersHash[playerId] != undefined){
		return usersHash[playerId]["name"];
	}
	return null;
}

function notifyJackInPlay(room){
	var gameState = room.gameState;
	if (gameState["jackCounter"] > 0){
		var currentPlayer = gameState["currentPlayer"];
		nowjs.getClient(currentPlayer, function(){
			this.now.showJackMessage();
		});
	}
}

function alertCurrentPlayer(room){
	var gameState = room.gameState;
	// this gets called if everyone else autopasses
	var currentPlayer = gameState["currentPlayer"];
	nowjs.getClient(currentPlayer, function(){
		this.now.showMakeMoveButton();
	});
}

function getNextPlayer(room){
	var gameState = room.gameState;
	var players = gameState["players"];
	var nextPlayerIndex = (players.indexOf(gameState["currentPlayer"])+1)%(players.length);
	while (gameState["moveBits"][nextPlayerIndex] == -1){
		nextPlayerIndex = (nextPlayerIndex+1)%(players.length);
	}
	var nextPlayerId = players[nextPlayerIndex];
	return nextPlayerId;
}

function alertNextPlayer(room){
	var gameState = room.gameState;
	var usersHash = room.usersHash;
	var roomClients = getRoomClients(room);
	// finds the next player with moveBit != -1
	var players = gameState["players"];
	
	if (players.length > 0){
		var autoPassedPlayers = [];
		while (true){
			var hand = gameState["currentPlayHistory"][gameState["currentPlayHistory"].length - 1];
			if (hand != undefined && gameState["jackCounter"] <= 1 && !canPlayHigher(hand)){
				passEveryone(room);
				return;
			}
			else{
				var nextPlayerId = getNextPlayer(room);
				gameState["currentPlayer"] = nextPlayerId;
				if ((gameState["currentPlaySize"] != null && usersHash[nextPlayerId]["hand"].length < gameState["currentPlaySize"]) || (gameState["jackCounter"] > 1 && !canPlayLower(hand))){				
					// highlight current player, then pass this player
					roomClients.forEach(function(clientId){
						nowjs.getClient(clientId, function(){
							this.now.showCurrentPlayer(nextPlayerId);
						});
					});
					pass(nextPlayerId, room);
					checkEveryonePassed(room);
				
					// add to queue to pass:
					autoPassedPlayers.push(nextPlayerId);
				
					// show he autopasses (FRONTEND)
					nowjs.getClient(nextPlayerId, function(){
						this.now.showAutoPass();
					});
					setTimeout(function(){
						var playerToPass = autoPassedPlayers.shift();
						nowjs.getClient(playerToPass, function(){
							this.now.removeAutoPass();
						});
					}, 1000);
				}
				else {
					break;
				}
			}
		}
		
		roomClients.forEach(function(clientId){
			nowjs.getClient(clientId, function(){
				this.now.showCurrentPlayer(nextPlayerId);
			});
		});
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

function passEveryone(room){
	var gameState = room.gameState;
	var usersHash = room.usersHash;
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
			handleEveryonePass(room);
			if (usersHash[currentPlayer]["hand"].length == 0){
				alertNextPlayer(room);
			}
			else{
				alertCurrentPlayer(room);
			}
		}, 1000);
	}
}

function removeCardsFromHand(cards, clientId, room){
	var usersHash = room.usersHash;
	// removes cards from the players hand (BACKEND)
	var tempHand = usersHash[clientId]["hand"];
	var indexOfCard;
	cards.forEach(function(card){
		indexOfCard = tempHand.indexOf(card);
		tempHand.splice(indexOfCard, 1);
	});
	usersHash[clientId]["hand"] = tempHand;
	// make call to update FRONTEND
	updatePlayerHand(cards, clientId, "remove", room);
}

function handleEveryonePass(room){
	// what to do when everyone passes
	var gameState = room.gameState;
	var roomClients = getRoomClients(room);
	
	roomClients.forEach(function(clientId){
		nowjs.getClient(clientId, function(){
			this.now.clearStage();
		});
	});
	
	// get all the cards played in the current round and shove to discard pile
	var currentRoundCards = gameState["currentPlayHistory"].flatten();		
	var numDiscarded = currentRoundCards.length;
	currentRoundCards.forEach(function(card){
		gameState["discardPile"].push(card);
	});
	// update play history and play size
	gameState["currentPlayHistory"] = [];
	gameState["currentPlaySize"] = null;
	
	// reset moveBits to 1 for all active players
	setMoveBitsToOne(room);
	
	// update the discard pile (FRONTEND)
	roomClients.forEach(function(clientId){
		nowjs.getClient(clientId, function(){
			this.now.addToDiscardPile(currentRoundCards.length);
		});
	});
}

function pass(clientId, room){
	var gameState = room.gameState;
	console.log("client "+ clientId + " is passing");
	updateJackCounter(room);
	var playerIndex = gameState["players"].indexOf(clientId);	
	gameState["moveBits"][playerIndex] = 0;		// use 0 to indicate that the player has just passed
}

function checkEveryonePassed(room){
	var everyonePassed = false;
	var gameState = room.gameState;
	// check that all players (with cards) have passed. just check that there are no 1's
	if (gameState["moveBits"].indexOf(1) == -1){
		// everyone has passed
		everyonePassed = true;
	}
	if (everyonePassed){
		handleEveryonePass(room);	// what to do when everyone passes
	}
}

everyone.now.sendPassMove = function(){
	var clientSession = getClientSession(this.user);
	var roomId = clientSession.roomId;
	var room = rooms[roomId - 1];
	
	pass(this.user.clientId, room);
	checkEveryonePassed(room);
	// alert the next player to make a move
	alertNextPlayer(room);
}


// rules
function checkRules(hand, room){
	// check not the first move of the game
	var usersHash = room.usersHash;
	var gameState = room.gameState;
	
	if (gameState["moves"] == 0){
		var lowestCard = usersHash[gameState["currentPlayer"]]["hand"][0];
		if (threeOfClubsDealt(room) && !hasThreeOfClubs(hand)){
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
				var compare = compareToHand(prevHand, hand, room);
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

function threeOfClubsDealt(room){
	var playerIds = getPlayerIds(room);
	var usersHash = room.usersHash;
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

function compareToHand(prevHand, newHand, room){
	if (prevHand.length != newHand.length || !hasValidLength(newHand)){
		return false;
	}
	// hands should be equal and valid length by here, just exploit getHandValue(hand)
	
	var gameState = room.gameState;
	
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
		if (isFullHouse(prevHand)){
			// must play a lower fullhouse
			if (isFullHouse(newHand) && (getHandValue(newHand) < getHandValue(prevHand))){
				return 1;
			}
			else{
				return -1;
			}
		}
		else{
			if (getHandValue(newHand) < getHandValue(prevHand)){
				return 1;
			}
			else{
				return -1;
			}
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
	// for A 2 3 4 5...
	// else if (getValue(hand[0]) == 3 && getValue(hand[1]) == 4 && getValue(hand[2]) == 5 && getValue(hand[3]) == 14 && getValue(hand[4]) == 15){
	// 	return true;
	// }
	// for 2 3 4 5 6...
	// else if (getValue(hand[0]) == 3 && getValue(hand[1]) == 4 && getValue(hand[2]) == 5 && getValue(hand[3]) == 6 && getValue(hand[4]) == 15){
	// 		return true;
	// 	}
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

function getPlayerIds(room) {
	// returns ids of players who are still connected (does not include leavers)
	var playerIds = [];
	var usersHash = room.usersHash;
	
	for (var key in usersHash){
		if (usersHash[key]["type"] == "Player"){
			playerIds.push(key);
		}
	}
	return playerIds;
}
function getObserverIds(room) {
	var observerIds = [];
	var usersHash = room.usersHash;
	
	for (var key in usersHash){
		if (usersHash[key]["type"] == "Observer"){
			observerIds.push(key);
		}
	}
	return observerIds;
}

function getNumPlayers(room) {
	var numPlayers = 0;
	var usersHash = room.usersHash;
	
	for (var key in usersHash){
		if (usersHash[key]["type"] == "Player"){
			numPlayers++;
		}
	}
	return numPlayers;
}

// chat, nickname functions
everyone.now.submitChat = function(message) {
	var clientSession = getClientSession(this.user);
	var roomId = clientSession.roomId;
	var room = rooms[roomId - 1];
	var roomClients = getRoomClients(room);
	var usersHash = room.usersHash;
	
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
	var clientName = getPlayerName(clientId, room);
	var userInfo = {"id": clientId, "name": clientName};
	var messageHash = {"userInfo": userInfo, "type": type, "text": text}
	var color = usersHash[clientId]["color"];
	
	roomClients.forEach(function(clientId){
		nowjs.getClient(clientId, function(){
			this.now.updateChat(messageHash, color);
		});
	});
}
everyone.now.submitNickname = function(name) {
	var clientSession = getClientSession(this.user);
	var roomId = clientSession.roomId;
	var room = rooms[roomId - 1];
	var roomClients = getRoomClients(room);
	var usersHash = room.usersHash;
	
	// update entry for client in usersHash
	var clientId = this.user.clientId;
	usersHash[clientId]["name"] = name;
	this.now.name = name;
	
	// call updateName
	updateName(room);
	
	// update the scoreboard (because scoreboard has names)
	roomClients.forEach(function(clientId){
		nowjs.getClient(clientId, function(){
			this.now.updateScoreboard(usersHash);
		});
	});
}

function updateName(room) {
	var gameState = room.gameState;
	var usersHash = room.usersHash;
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

// assign unique colors
function assignUniqueColor(clientId, room){
	var usersHash = room.usersHash;
	
	var color = "#";
	var firstHexKey = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'A'];
	var secondHexKey = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'A', 'B', 'C', 'D', 'E', 'F'];
	for (var i = 0; i < 6; i++){
		if (i%2 == 0){
			color += firstHexKey[Math.floor(Math.random()*firstHexKey.length)];
		}
		else{
			color += secondHexKey[Math.floor(Math.random()*secondHexKey.length)];
		}
	}
	usersHash[clientId]["color"] = color;
}

// ******************** deck functions ********************
function initDeck(room) {
	room.deck = ["AC", "2C", "3C", "4C", "5C", "6C", "7C", "8C", "9C", "10C", "JC", "QC", "KC",
			"AD", "2D", "3D", "4D", "5D", "6D", "7D", "8D", "9D", "10D", "JD", "QD", "KD",
			"AH", "2H", "3H", "4H", "5H", "6H", "7H", "8H", "9H", "10H", "JH", "QH", "KH",
			"AS", "2S", "3S", "4S", "5S", "6S", "7S", "8S", "9S", "10S", "JS", "QS", "KS"];
}
function shuffleCards(room) {	// duh
	var cards = room.deck;
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