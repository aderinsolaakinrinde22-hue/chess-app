(() => {
	const PIECES = {
		wk: "♔", wq: "♕", wr: "♖", wb: "♗", wn: "♘", wp: "♙",
		bk: "♚", bq: "♛", br: "♜", bb: "♝", bn: "♞", bp: "♟"
	};
	const VALUES = { p: 100, n: 320, b: 335, r: 500, q: 900, k: 0 };
	const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
	const files = "abcdefgh";
	let game = new Chess();
	let difficulty = "medium";
	let selectedSquare = null;
	let legalTargets = [];
	let hintMove = null;
	let strategyPending = false;
	let strategyRequestId = 0;
	let autoPlayActive = false;
	let autoPlaySummary = "";
	let moveMistakes = new Map();
	let pendingMoveAnimation = null;
	let hintPending = false;
	let hintRequestId = 0;
	let hints = 4;
	let rewinds = 2;
	let gameOver = false;
	let engineTimer = null;
	let javaEngineAvailable = false;
	let stockfishWorker = null;
	let stockfishReady = false;
	let stockfishLoading = false;
	let stockfishReadyPromise = null;
	let stockfishInitialization = null;
	let stockfishSearch = null;

	const byId = (id) => document.getElementById(id);

	function strategyUnlockMoveCount() {
		return { easy: 20, medium: 25, hard: 30, impossible: 45 }[difficulty];
	}

	function buildPreview() {
		const board = byId("preview-board");
		for (let row = 0; row < 8; row += 1) {
			for (let col = 0; col < 8; col += 1) {
				const square = document.createElement("div");
				square.className = `preview-square ${(row + col) % 2 ? "dark" : "light"}`;
				const piece = game.board()[row][col];
				if (piece) {
					const glyph = document.createElement("span");
					glyph.className = `preview-piece ${piece.color === "b" ? "black" : "white"}`;
					glyph.textContent = PIECES[`${piece.color}${piece.type}`];
					square.append(glyph);
				}
				board.append(square);
			}
		}
	}

	function setScreen(name) {
		document.querySelectorAll(".screen").forEach((screen) => {
			const active = screen.id === `${name}-screen`;
			screen.hidden = !active;
			screen.classList.toggle("is-active", active);
		});
		byId("home-button").hidden = name === "home";
	}

	function chooseMode(mode) {
		document.querySelectorAll(".mode-option").forEach((button) => {
			const selected = button.dataset.mode === mode;
			button.classList.toggle("is-selected", selected);
			button.setAttribute("aria-pressed", String(selected));
		});
		byId("difficulty-row").hidden = mode !== "play";
		byId("start-button").querySelector("span:first-child").textContent = mode === "play" ? "Start a game" : "Open the solver";
		byId("start-button").dataset.mode = mode;
	}

	function makeBoard(boardElement, chess, interactive, markers = {}) {
		boardElement.replaceChildren();
		const position = chess.board();
		for (let row = 0; row < 8; row += 1) {
			for (let col = 0; col < 8; col += 1) {
				const squareName = `${files[col]}${8 - row}`;
				const piece = position[row][col];
				const square = document.createElement("button");
				square.type = "button";
				square.className = `square ${(row + col) % 2 ? "dark" : "light"}`;
				square.dataset.square = squareName;
				square.setAttribute("role", "gridcell");
				square.setAttribute("aria-label", `${squareName}${piece ? ` ${piece.color === "w" ? "white" : "black"} ${piece.type}` : " empty"}`);
				if (markers.lastMove?.includes(squareName)) square.classList.add("last-move");
				if (markers.selected === squareName) square.classList.add("selected");
				if (markers.hint?.from === squareName) square.classList.add("hint-from");
				if (markers.hint?.to === squareName) square.classList.add("hint-to");
				if (markers.targets?.some((move) => move.to === squareName)) {
					square.classList.add("legal-target");
					if (piece) square.classList.add("legal-capture");
				}
				if ((col === 0 || row === 7) && interactive) {
					if (col === 0) {
						const rank = document.createElement("span");
						rank.className = "coordinate";
						rank.textContent = String(8 - row);
						square.append(rank);
					}
					if (row === 7) {
						const file = document.createElement("span");
						file.className = "coordinate file-coordinate";
						file.textContent = files[col];
						square.append(file);
					}
				}
				if (piece) {
					const glyph = document.createElement("span");
					glyph.className = `piece ${piece.color === "w" ? "white-piece" : "black-piece"}`;
					glyph.textContent = PIECES[`${piece.color}${piece.type}`];
					square.append(glyph);
				}
				if (interactive) square.addEventListener("click", () => handleSquareClick(squareName));
				boardElement.append(square);
			}
		}
	}

	function renderGame() {
		const history = game.history({ verbose: true });
		const lastMove = history.length ? [history[history.length - 1].from, history[history.length - 1].to] : [];
		const board = byId("game-board");
		const animatedMove = pendingMoveAnimation;
		pendingMoveAnimation = null;
		let originRect = null;
		if (animatedMove && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
			const originPiece = board.querySelector(`[data-square="${animatedMove.from}"] .piece`);
			if (originPiece) originRect = originPiece.getBoundingClientRect();
		}
		makeBoard(board, game, true, { lastMove, selected: selectedSquare, targets: legalTargets, hint: hintMove });
		if (originRect) {
			const destinationPiece = board.querySelector(`[data-square="${animatedMove.to}"] .piece`);
			if (destinationPiece) {
				const destinationRect = destinationPiece.getBoundingClientRect();
				const deltaX = originRect.left - destinationRect.left;
				const deltaY = originRect.top - destinationRect.top;
				destinationPiece.animate([
					{ transform: `translate(${deltaX}px, ${deltaY}px) scale(.88)`, opacity: .72 },
					{ transform: `translate(${deltaX * .5}px, ${deltaY * .5 - 12}px) scale(1.08)`, opacity: 1, offset: .56 },
					{ transform: "translate(0, 0) scale(1)" }
				], { duration: 280, easing: "cubic-bezier(.2, .75, .3, 1)" });
			}
		}
		renderMoveLog();
		updateGameStatus();
		byId("hints-count").textContent = `${hints} left`;
		byId("rewinds-count").textContent = `${rewinds} left`;
		byId("hint-button").disabled = hints === 0 || gameOver || game.turn() !== "w" || hintPending || autoPlayActive;
		byId("rewind-button").disabled = rewinds === 0 || gameOver || history.length < 2 || game.turn() !== "w" || autoPlayActive;
		byId("hint-button").setAttribute("aria-label", `Get a hint, ${hints} remaining`);
		byId("rewind-button").setAttribute("aria-label", `Rewind one turn, ${rewinds} remaining`);
		const playerMoves = history.filter((move) => move.color === "w").length;
		const unlockAt = strategyUnlockMoveCount();
		const strategyReady = playerMoves >= unlockAt;
		byId("strategy-button").disabled = autoPlayActive
			? gameOver
			: !strategyReady || gameOver || game.turn() !== "w" || strategyPending || hintPending;
		byId("strategy-icon").textContent = autoPlayActive ? "■" : "▶";
		byId("strategy-count").textContent = autoPlayActive ? strategyPending ? "reviewing" : "playing" : strategyReady ? "ready" : `${unlockAt - playerMoves} to go`;
		byId("strategy-button").title = autoPlayActive ? "Stop auto-play" : "Unlocks after 16 of your moves";
		byId("strategy-button").setAttribute("aria-label", autoPlayActive
			? "Stop auto-play"
			: strategyReady ? "Auto-play your side and review mistakes" : `Auto-play and review, available after your ${unlockAt}th move, ${unlockAt - playerMoves} to go`);
	}

	function renderMoveLog() {
		const history = game.history();
		const list = byId("move-list");
		list.replaceChildren();
		for (let index = 0; index < history.length; index += 2) {
			const item = document.createElement("li");
			const number = document.createElement("span");
			number.className = "move-number";
			number.textContent = `${Math.floor(index / 2) + 1}.`;
			const white = document.createElement("span");
			white.className = "move-san";
			white.textContent = history[index];
			const mistake = moveMistakes.get(index);
			if (mistake) {
				white.classList.add("move-mistake");
				white.title = `Notable miss. ${mistake.betterSan} scored about ${(mistake.loss / 100).toFixed(1)} pawns better in the short search.`;
				white.setAttribute("aria-label", `${history[index]}, notable miss; consider ${mistake.betterSan}`);
				const marker = document.createElement("span");
				marker.className = "mistake-marker";
				marker.textContent = "!";
				white.append(marker);
			}
			const black = document.createElement("span");
			black.className = "move-san";
			black.textContent = history[index + 1] || "";
			item.append(number, white, black);
			list.append(item);
		}
		byId("move-total").textContent = `${Math.ceil(history.length / 2)} ${Math.ceil(history.length / 2) === 1 ? "MOVE" : "MOVES"}`;
		byId("empty-log").hidden = history.length > 0;
	}

	function updateGameStatus() {
		const userToMove = game.turn() === "w";
		const status = autoPlayActive && userToMove ? "Auto-playing your move..." : game.in_check() ? "Check! Find a safe square" : userToMove ? "Your move" : "Studio is thinking...";
		byId("game-status").textContent = status;
		byId("opponent-turn").classList.toggle("is-active", !userToMove && !gameOver);
		byId("user-turn").classList.toggle("is-active", userToMove && !gameOver);
	}

	function handleSquareClick(square) {
		if (gameOver || game.turn() !== "w" || autoPlayActive) return;
		hintMove = null;
		if (selectedSquare) {
			const move = game.move({ from: selectedSquare, to: square, promotion: "q" });
			if (move) {
				strategyRequestId += 1;
				strategyPending = false;
				pendingMoveAnimation = { from: move.from, to: move.to };
				selectedSquare = null;
				legalTargets = [];
				renderGame();
				if (checkGameEnd()) return;
				engineTimer = window.setTimeout(playEngineMove, 120);
				return;
			}
		}
		const piece = game.get(square);
		if (piece && piece.color === "w") {
			selectedSquare = square;
			legalTargets = game.moves({ square, verbose: true });
		} else {
			selectedSquare = null;
			legalTargets = [];
		}
		renderGame();
	}

	function evaluate(position) {
		if (position.in_checkmate()) return -100000;
		if (position.in_draw() || position.in_stalemate()) return 0;
		const sideToMove = position.turn();
		let score = 0;
		const board = position.board();
		for (let row = 0; row < 8; row += 1) {
			for (let col = 0; col < 8; col += 1) {
				const piece = board[row][col];
				if (!piece) continue;
				const sign = piece.color === sideToMove ? 1 : -1;
				const advance = piece.color === "w" ? 6 - row : row - 1;
				const center = 3.5 - (Math.abs(3.5 - row) + Math.abs(3.5 - col)) / 2;
				const positional = piece.type === "p" ? advance * 5 : piece.type === "n" || piece.type === "b" ? center * 7 : 0;
				score += sign * (VALUES[piece.type] + positional);
			}
		}
		return score;
	}

	function search(position, depth, alpha, beta, ply = 0) {
		if (position.in_checkmate()) return -100000 + ply;
		if (position.in_draw() || position.in_stalemate()) return 0;
		if (depth === 0) return evaluate(position);
		let best = -Infinity;
		const moves = position.moves({ verbose: true });
		for (const move of moves) {
			position.move(move);
			const score = -search(position, depth - 1, -beta, -alpha, ply + 1);
			position.undo();
			best = Math.max(best, score);
			alpha = Math.max(alpha, score);
			if (alpha >= beta) break;
		}
		return best;
	}

	function rankMovesLocally(position, depth) {
		const moves = position.moves({ verbose: true });
		const ranked = [];
		for (const move of moves) {
			position.move(move);
			const score = -search(position, depth - 1, -Infinity, Infinity, 1);
			position.undo();
			ranked.push({ move, score });
		}
		ranked.sort((a, b) => b.score - a.score);
		return ranked;
	}

	function findBestMoveLocally(position, depth, casual = false) {
		const ranked = rankMovesLocally(position, depth);
		if (casual && difficulty === "easy") return ranked[Math.floor(Math.random() * Math.min(6, ranked.length))]?.move || null;
		return ranked[0]?.move || null;
	}

	function createAnalysisTree(position, depth) {
		const rootSide = position.turn();
		const leaves = [];
		function visit(remainingDepth, path) {
			if (position.game_over()) {
				const score = position.in_checkmate() ? (position.turn() === rootSide ? -100000 : 100000) : 0;
				leaves.push(`${path.join("/")}\t${position.fen()}\t${score}`);
				return;
			}
			if (remainingDepth === 0) {
				leaves.push(`${path.join("/")}\t${position.fen()}\t`);
				return;
			}
			for (const move of position.moves({ verbose: true })) {
				position.move(move);
				const uciMove = `${move.from}${move.to}${move.promotion || ""}`;
				visit(remainingDepth - 1, [...path, uciMove]);
				position.undo();
			}
		}
		visit(depth, []);
		return `${rootSide}\n${leaves.join("\n")}`;
	}

	async function findBestMove(position, depth, casual = false) {
		if (casual && difficulty === "easy") return findBestMoveLocally(position, depth, true);
		if (difficulty === "impossible") {
			try {
				return (await findStockfishMoves(position, 1, 2000))[0] || null;
			} catch (error) {
				updateEngineStatus();
			}
		}
		if (javaEngineAvailable) {
			try {
				const response = await fetch("/api/analyze", {
					method: "POST",
					headers: { "Content-Type": "text/plain; charset=utf-8" },
					body: createAnalysisTree(position, depth)
				});
				if (!response.ok) throw new Error("Java analysis request failed");
				const result = await response.json();
				if (!result.move) return null;
				const bestMove = position.moves({ verbose: true }).find((move) =>
					`${move.from}${move.to}${move.promotion || ""}` === result.move
				);
				if (!bestMove) return null;
				bestMove.score = result.score;
				return bestMove;
			} catch (error) {
				javaEngineAvailable = false;
				updateEngineStatus();
			}
		}
		return findBestMoveLocally(position, depth, casual);
	}

	async function findBestMoves(position, depth, limit = 3) {
		if (javaEngineAvailable) {
			try {
				const response = await fetch("/api/analyze", {
					method: "POST",
					headers: { "Content-Type": "text/plain; charset=utf-8" },
					body: createAnalysisTree(position, depth)
				});
				if (!response.ok) throw new Error("Java analysis request failed");
				const result = await response.json();
				const legalMoves = position.moves({ verbose: true });
				const alternatives = Array.isArray(result.alternatives)
					? result.alternatives
					: [{ move: result.move, score: result.score }];
				return alternatives.slice(0, limit).map((candidate) => {
					const move = legalMoves.find((legalMove) =>
						`${legalMove.from}${legalMove.to}${legalMove.promotion || ""}` === candidate.move
					);
					return move ? { ...move, score: candidate.score } : null;
				}).filter(Boolean);
			} catch (error) {
				javaEngineAvailable = false;
				updateEngineStatus();
			}
		}
		return rankMovesLocally(position, depth).slice(0, limit).map(({ move, score }) => ({ ...move, score }));
	}

	function handleStockfishLine(line) {
		if (line === "uciok" && stockfishInitialization && !stockfishInitialization.readyRequested) {
			stockfishInitialization.readyRequested = true;
			stockfishWorker.postMessage("isready");
			return;
		}
		if (line === "readyok" && stockfishInitialization) {
			window.clearTimeout(stockfishInitialization.timer);
			stockfishReady = true;
			stockfishLoading = false;
			stockfishInitialization.resolve(stockfishWorker);
			stockfishInitialization = null;
			updateEngineStatus();
			return;
		}
		if (line.startsWith("info ") && stockfishSearch) {
			const fields = line.split(/\s+/);
			const scoreIndex = fields.indexOf("score");
			const pvIndex = fields.indexOf("pv");
			if (scoreIndex < 0 || pvIndex < 0 || !fields[pvIndex + 1]) return;
			const multipvIndex = fields.indexOf("multipv");
			const multipv = multipvIndex >= 0 ? Number(fields[multipvIndex + 1]) : 1;
			const scoreType = fields[scoreIndex + 1];
			const rawScore = Number(fields[scoreIndex + 2]);
			const score = scoreType === "mate"
				? rawScore > 0 ? 100000 - rawScore : -100000 - rawScore
				: rawScore;
			stockfishSearch.results.set(multipv, { uci: fields[pvIndex + 1], score });
			return;
		}
		if (line.startsWith("bestmove ") && stockfishSearch) {
			const request = stockfishSearch;
			stockfishSearch = null;
			window.clearTimeout(request.timer);
			const candidates = [...request.results.values()]
				.map((result) => {
					const move = request.legalMoves.find((candidate) =>
						`${candidate.from}${candidate.to}${candidate.promotion || ""}` === result.uci
					);
					return move ? { ...move, score: result.score } : null;
				})
				.filter(Boolean);
			if (!candidates.length) {
				const uci = line.split(/\s+/)[1];
				const move = request.legalMoves.find((candidate) =>
					`${candidate.from}${candidate.to}${candidate.promotion || ""}` === uci
				);
				if (move) candidates.push({ ...move, score: 0 });
			}
			request.resolve(candidates);
		}
	}

	function ensureStockfish() {
		if (stockfishReady) return Promise.resolve(stockfishWorker);
		if (stockfishReadyPromise) return stockfishReadyPromise;
		stockfishLoading = true;
		updateEngineStatus();
		stockfishReadyPromise = new Promise((resolve, reject) => {
			stockfishWorker = new Worker("/stockfish-19-lite-single.js");
			stockfishInitialization = {
				resolve,
				reject,
				readyRequested: false,
				timer: window.setTimeout(() => reject(new Error("Stockfish initialization timed out")), 30000)
			};
			stockfishWorker.addEventListener("message", (event) => {
				String(event.data).split(/\r?\n/).forEach(handleStockfishLine);
			});
			stockfishWorker.addEventListener("error", (event) => {
				stockfishInitialization?.reject(new Error(event.message || "Stockfish failed to load"));
				if (stockfishSearch) {
					stockfishSearch.reject(new Error(event.message || "Stockfish search failed"));
					stockfishSearch = null;
				}
			});
			stockfishWorker.postMessage("uci");
		}).catch((error) => {
			window.clearTimeout(stockfishInitialization?.timer);
			stockfishWorker?.terminate();
			stockfishWorker = null;
			stockfishInitialization = null;
			stockfishReady = false;
			stockfishLoading = false;
			stockfishReadyPromise = null;
			updateEngineStatus();
			throw error;
		});
		return stockfishReadyPromise;
	}

	async function findStockfishMoves(position, multipv = 1, moveTimeMs = 2000) {
		const worker = await ensureStockfish();
		if (stockfishSearch) throw new Error("Stockfish is already analyzing a position");
		return new Promise((resolve, reject) => {
			stockfishSearch = {
				resolve,
				reject,
				results: new Map(),
				legalMoves: position.moves({ verbose: true }),
				timer: window.setTimeout(() => {
					if (!stockfishSearch) return;
					stockfishSearch = null;
					worker.postMessage("stop");
					reject(new Error("Stockfish search timed out"));
				}, 45000)
			};
			worker.postMessage("ucinewgame");
			worker.postMessage(`setoption name MultiPV value ${multipv}`);
			worker.postMessage(`position fen ${position.fen()}`);
			worker.postMessage(`go movetime ${moveTimeMs}`);
		});
	}

	function updateEngineStatus() {
		const label = byId("engine-status");
		const dot = byId("engine-status-dot");
		label.textContent = difficulty === "impossible"
			? stockfishReady ? "STOCKFISH 19 ENGINE" : stockfishLoading ? "LOADING STOCKFISH" : "STOCKFISH OFFLINE"
			: javaEngineAvailable ? "JAVA CHESS ENGINE" : "LOCAL CHESS ENGINE";
		dot.classList.toggle("java-online", javaEngineAvailable);
		dot.classList.toggle("local-engine", !javaEngineAvailable);
		dot.classList.toggle("stockfish-online", difficulty === "impossible" && stockfishReady);
		dot.classList.toggle("stockfish-loading", difficulty === "impossible" && stockfishLoading);
	}

	async function checkJavaEngine() {
		try {
			const response = await fetch("/api/health");
			const health = response.ok ? await response.json() : null;
			javaEngineAvailable = health?.ready === true && health.engine === "java";
		} catch (error) {
			javaEngineAvailable = false;
		}
		updateEngineStatus();
	}

	function searchDepth() {
		return difficulty === "easy" ? 1 : difficulty === "hard" ? 3 : 2;
	}

	async function playAutoMove() {
		engineTimer = null;
		if (!autoPlayActive || gameOver || game.turn() !== "w") return;
		const activeGame = game;
		const searchedFen = activeGame.fen();
		byId("game-tip-text").textContent = `${autoPlaySummary ? `${autoPlaySummary} ` : ""}Auto-play is choosing your next move...`;
		const move = await findBestMove(activeGame, searchDepth());
		if (!autoPlayActive || game !== activeGame || gameOver || activeGame.turn() !== "w" || activeGame.fen() !== searchedFen) return;
		if (!move) {
			autoPlayActive = false;
			byId("game-tip-text").textContent = "Auto-play stopped because there are no legal moves.";
			renderGame();
			return;
		}
		const playedMove = activeGame.move({ from: move.from, to: move.to, promotion: move.promotion || "q" });
		if (!playedMove) return;
		pendingMoveAnimation = { from: playedMove.from, to: playedMove.to };
		byId("game-tip-text").textContent = `${autoPlaySummary ? `${autoPlaySummary} ` : ""}Auto-play chose ${playedMove.san}. The studio is replying.`;
		renderGame();
		if (checkGameEnd()) return;
		engineTimer = window.setTimeout(playEngineMove, 120);
	}

	async function playEngineMove() {
		engineTimer = null;
		if (gameOver || game.turn() !== "b") return;
		const activeGame = game;
		const searchedFen = activeGame.fen();
		const move = await findBestMove(activeGame, searchDepth(), true);
		if (game !== activeGame || gameOver || activeGame.turn() !== "b" || activeGame.fen() !== searchedFen) return;
		if (!move) return;
		const playedMove = game.move({ from: move.from, to: move.to, promotion: "q" });
		if (!playedMove) return;
		pendingMoveAnimation = { from: playedMove.from, to: playedMove.to };
		renderGame();
		if (checkGameEnd()) return;
		if (autoPlayActive) engineTimer = window.setTimeout(playAutoMove, 180);
	}

	function checkGameEnd() {
		if (!game.game_over()) return false;
		gameOver = true;
		autoPlayActive = false;
		strategyPending = false;
		const resultMessage = game.in_checkmate()
			? game.turn() === "b" ? "You found checkmate." : "The studio found checkmate."
			: "The game ended in a draw.";
		byId("game-tip-text").textContent = `${autoPlaySummary ? `${autoPlaySummary} ` : ""}${resultMessage}`;
		renderGame();
		const won = game.in_checkmate() && game.turn() === "b";
		const lost = game.in_checkmate() && game.turn() === "w";
		byId("result-eyebrow").textContent = won ? "NICELY PLAYED" : lost ? "GOOD TRY" : "A GAME WELL PLAYED";
		byId("result-title").textContent = won ? "You found mate." : lost ? "The studio got you." : "A lovely draw.";
		byId("result-copy").textContent = won ? "A brilliant finish. Ready for another?" : lost ? "Every game leaves you with a new idea." : "A little balance on the board.";
		byId("result-piece").textContent = won ? "♕" : lost ? "♚" : "♔";
		byId("result-overlay").hidden = false;
		populateConfetti(won);
		byId("play-again-button").focus();
		return true;
	}

	function populateConfetti(won) {
		const confetti = byId("result-confetti");
		confetti.replaceChildren();
		const colors = won ? ["#202020", "#777777", "#bdbdbd", "#ffffff"] : ["#333333", "#888888", "#d4d4d4"];
		for (let index = 0; index < 42; index += 1) {
			const piece = document.createElement("span");
			piece.className = "confetti-piece";
			piece.style.left = `${Math.random() * 100}%`;
			piece.style.setProperty("--confetti-color", colors[index % colors.length]);
			piece.style.setProperty("--fall-time", `${2.3 + Math.random() * 2.1}s`);
			piece.style.setProperty("--fall-delay", `${Math.random() * .7}s`);
			piece.style.setProperty("--drift", `${Math.random() * 130 - 65}px`);
			confetti.append(piece);
		}
	}

	function startGame() {
		window.clearTimeout(engineTimer);
		game = new Chess();
		hints = 4;
		rewinds = 2;
		hintRequestId += 1;
		hintPending = false;
		strategyRequestId += 1;
		strategyPending = false;
		autoPlayActive = false;
		autoPlaySummary = "";
		moveMistakes.clear();
		gameOver = false;
		selectedSquare = null;
		legalTargets = [];
		hintMove = null;
		pendingMoveAnimation = null;
		byId("result-overlay").hidden = true;
		byId("game-tip-text").textContent = "The center is a lovely place to start.";
		byId("difficulty-label").textContent = { easy: "Easy", medium: "Steady", hard: "Tricky", impossible: "Impossible" }[difficulty];
		renderGame();
		setScreen("game");
	}

	async function showHint() {
		if (hints <= 0 || game.turn() !== "w" || gameOver || hintPending) return;
		strategyRequestId += 1;
		strategyPending = false;
		const activeGame = game;
		const searchedFen = activeGame.fen();
		const requestId = ++hintRequestId;
		hintPending = true;
		renderGame();
		try {
			const move = await findBestMove(activeGame, Math.min(searchDepth(), 2));
			if (requestId !== hintRequestId || game !== activeGame || gameOver || activeGame.turn() !== "w" || activeGame.fen() !== searchedFen || !move) return;
			hints -= 1;
			selectedSquare = null;
			legalTargets = [];
			hintMove = { from: move.from, to: move.to };
			byId("game-tip-text").textContent = `Try ${move.from} to ${move.to}${move.promotion ? ` = ${move.promotion.toUpperCase()}` : ""}. The board shows the suggested move.`;
		} finally {
			if (requestId === hintRequestId) {
				hintPending = false;
				renderGame();
			}
		}
	}

	async function toggleAutoPlay() {
		if (autoPlayActive) {
			const cancelledReview = strategyPending;
			autoPlayActive = false;
			strategyPending = false;
			strategyRequestId += 1;
			if (game.turn() === "w") {
				window.clearTimeout(engineTimer);
				engineTimer = null;
			}
			if (cancelledReview) moveMistakes.clear();
			autoPlaySummary = "";
			byId("game-tip-text").textContent = "Auto-play stopped. You can continue your game.";
			renderGame();
			return;
		}

		const history = game.history({ verbose: true });
		const playerMoves = history.filter((move) => move.color === "w").length;
		if (playerMoves < strategyUnlockMoveCount() || gameOver || game.turn() !== "w" || strategyPending || hintPending) return;

		const activeGame = game;
		const searchedFen = activeGame.fen();
		const requestId = ++strategyRequestId;
		autoPlayActive = true;
		strategyPending = true;
		autoPlaySummary = "";
		moveMistakes.clear();
		hintMove = null;
		selectedSquare = null;
		legalTargets = [];
		renderGame();

		const reviewPosition = new Chess();
		try {
			for (let ply = 0; ply < history.length; ply += 2) {
				if (requestId !== strategyRequestId || game !== activeGame || gameOver || activeGame.fen() !== searchedFen) return;
				const actualMove = history[ply];
				const moveNumber = Math.floor(ply / 2) + 1;
				byId("game-tip-text").textContent = `Reviewing your move ${moveNumber} of ${playerMoves}...`;
				const candidates = await findBestMoves(reviewPosition, 1, Number.POSITIVE_INFINITY);
				if (requestId !== strategyRequestId || game !== activeGame || gameOver || activeGame.fen() !== searchedFen) return;
				const played = candidates.find((move) => move.from === actualMove.from && move.to === actualMove.to && (move.promotion || "") === (actualMove.promotion || ""));
				const best = candidates[0];
				if (best && played && (best.from !== played.from || best.to !== played.to || best.promotion !== played.promotion) && best.score - played.score >= 180) {
					moveMistakes.set(ply, { betterSan: best.san, loss: best.score - played.score });
				}
				reviewPosition.move(actualMove);
				if (history[ply + 1]) reviewPosition.move(history[ply + 1]);
			}
			if (requestId !== strategyRequestId || game !== activeGame || gameOver || activeGame.fen() !== searchedFen) return;
			const mistakeCount = moveMistakes.size;
			const details = [...moveMistakes.entries()].slice(0, 3).map(([ply, mistake]) =>
				`${Math.floor(ply / 2) + 1}.${history[ply].san} → ${mistake.betterSan}`
			).join("; ");
			autoPlaySummary = mistakeCount
				? `Review marked ${mistakeCount} notable miss${mistakeCount === 1 ? "" : "es"} with ! (${details}). A one-move estimate.`
				: "Review found no major misses in its one-move estimate.";
			byId("game-tip-text").textContent = `${autoPlaySummary} Auto-play is starting.`;
		} finally {
			if (requestId === strategyRequestId) {
				strategyPending = false;
				renderGame();
			}
		}
		if (requestId === strategyRequestId && autoPlayActive && !gameOver) await playAutoMove();
	}

	function rewindTurn() {
		if (rewinds <= 0 || game.history().length < 2 || game.turn() !== "w" || gameOver || autoPlayActive) return;
		window.clearTimeout(engineTimer);
		engineTimer = null;
		strategyRequestId += 1;
		strategyPending = false;
		autoPlaySummary = "";
		moveMistakes.clear();
		if (game.turn() === "w" && game.history().length >= 2) {
			game.undo();
			game.undo();
		} else if (game.turn() === "b") {
			game.undo();
		}
		rewinds -= 1;
		hintMove = null;
		selectedSquare = null;
		legalTargets = [];
		byId("game-tip-text").textContent = "A fresh look. Your move.";
		renderGame();
	}

	function bindEvents() {
		document.querySelectorAll(".mode-option").forEach((button) => button.addEventListener("click", () => chooseMode(button.dataset.mode)));
		document.querySelectorAll("[data-difficulty]").forEach((button) => button.addEventListener("click", () => {
			difficulty = button.dataset.difficulty;
			document.body.classList.toggle("impossible-mode", difficulty === "impossible");
			document.querySelector('meta[name="theme-color"]').content = difficulty === "impossible" ? "#922c2c" : "#f3f3f3";
			document.querySelectorAll("[data-difficulty]").forEach((option) => {
				const selected = option === button;
				option.classList.toggle("is-selected", selected);
				option.setAttribute("aria-pressed", String(selected));
			});
			updateEngineStatus();
			if (difficulty === "impossible") ensureStockfish().catch(() => {});
		}));
		byId("start-button").addEventListener("click", startGame);
		byId("home-button").addEventListener("click", () => {
			window.clearTimeout(engineTimer);
			engineTimer = null;
			autoPlayActive = false;
			strategyPending = false;
			strategyRequestId += 1;
			setScreen("home");
		});
		byId("new-game-button").addEventListener("click", startGame);
		byId("hint-button").addEventListener("click", showHint);
		byId("rewind-button").addEventListener("click", rewindTurn);
		byId("strategy-button").addEventListener("click", toggleAutoPlay);
		byId("play-again-button").addEventListener("click", startGame);
		byId("result-home-button").addEventListener("click", () => { byId("result-overlay").hidden = true; setScreen("home"); });
	}

	function initialize() {
		if (typeof Chess !== "function") {
			byId("home-title").textContent = "Chess rules could not load.";
			byId("start-button").disabled = true;
			return;
		}
		buildPreview();
		bindEvents();
		renderGame();
		setScreen("home");
		checkJavaEngine();
	}

	initialize();
})();
