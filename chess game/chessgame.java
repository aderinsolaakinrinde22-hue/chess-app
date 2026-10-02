import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class chessgame {
	private static final int MAX_REQUEST_BYTES = 2_000_000;
	private static final Map<Character, Integer> PIECE_VALUES = Map.of(
		'p', 100, 'n', 320, 'b', 335, 'r', 500, 'q', 900, 'k', 0
	);
	private static final Path ROOT = Path.of(System.getProperty("chess.root", "."))
		.toAbsolutePath().normalize();

	private static final class Node {
		private final Map<String, Node> children = new LinkedHashMap<>();
		private Double score;
	}

	public static void main(String[] args) throws IOException {
		int port = args.length > 0 ? Integer.parseInt(args[0]) : 8000;
		HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 0);
		server.createContext("/api/health", chessgame::health);
		server.createContext("/api/analyze", chessgame::analyze);
		server.createContext("/", chessgame::serveFile);
		server.setExecutor(null);
		server.start();
		System.out.printf("Good Move chess server: http://127.0.0.1:%d/chessgame.html%n", port);
		System.out.printf("Serving files from: %s%n", ROOT);
	}

	private static void health(HttpExchange exchange) throws IOException {
		if (!"GET".equals(exchange.getRequestMethod())) {
			exchange.getResponseHeaders().set("Allow", "GET");
			send(exchange, 405, "text/plain; charset=utf-8", "GET required");
			return;
		}
		send(exchange, 200, "application/json; charset=utf-8", "{\"engine\":\"java\",\"ready\":true}");
	}

	private static void analyze(HttpExchange exchange) throws IOException {
		if (!"POST".equals(exchange.getRequestMethod())) {
			exchange.getResponseHeaders().set("Allow", "POST");
			send(exchange, 405, "text/plain; charset=utf-8", "POST required");
			return;
		}

		byte[] bytes = exchange.getRequestBody().readNBytes(MAX_REQUEST_BYTES + 1);
		if (bytes.length > MAX_REQUEST_BYTES) {
			send(exchange, 413, "text/plain; charset=utf-8", "Analysis tree is too large");
			return;
		}
		String[] lines = new String(bytes, StandardCharsets.UTF_8).split("\\R");
		if (lines.length < 2 || !("w".equals(lines[0]) || "b".equals(lines[0]))) {
			send(exchange, 400, "text/plain; charset=utf-8", "Expected a side to move and at least one leaf");
			return;
		}

		try {
			char perspective = lines[0].charAt(0);
			Node root = new Node();
			for (int index = 1; index < lines.length; index++) {
				if (lines[index].isBlank()) continue;
				String[] fields = lines[index].split("\\t", 3);
				if (fields.length < 2 || fields[1].isBlank()) {
					throw new IllegalArgumentException("Each leaf needs a move path and FEN");
				}
				Node node = root;
				if (!fields[0].isBlank()) {
					for (String move : fields[0].split("/")) {
						if (!move.matches("[a-h][1-8][a-h][1-8][qrbn]?")) {
							throw new IllegalArgumentException("Invalid move in analysis tree");
						}
						node = node.children.computeIfAbsent(move, ignored -> new Node());
					}
				}
				if (fields.length == 3 && !fields[2].isBlank()) {
					node.score = (double) Integer.parseInt(fields[2]);
				} else {
					node.score = evaluateFen(fields[1], perspective);
				}
			}

			List<Map.Entry<String, Double>> rankedMoves = new ArrayList<>();
			for (Map.Entry<String, Node> child : root.children.entrySet()) {
				double score = minimax(child.getValue(), false);
				rankedMoves.add(Map.entry(child.getKey(), score));
			}
			rankedMoves.sort((first, second) -> Double.compare(second.getValue(), first.getValue()));
			String bestMove = rankedMoves.isEmpty() ? null : rankedMoves.get(0).getKey();
			double bestScore = rankedMoves.isEmpty() ? 0 : rankedMoves.get(0).getValue();
			StringBuilder alternatives = new StringBuilder("[");
			for (int index = 0; index < rankedMoves.size(); index++) {
				if (index > 0) alternatives.append(',');
				Map.Entry<String, Double> move = rankedMoves.get(index);
				alternatives.append("{\"move\":\"").append(move.getKey())
					.append("\",\"score\":").append(move.getValue().intValue()).append('}');
			}
			alternatives.append(']');
			String moveJson = bestMove == null ? "null" : "\"" + bestMove + "\"";
			send(exchange, 200, "application/json; charset=utf-8",
				"{\"move\":" + moveJson + ",\"score\":" + (int) bestScore + ",\"alternatives\":" + alternatives + "}");
		} catch (IllegalArgumentException exception) {
			send(exchange, 400, "text/plain; charset=utf-8", exception.getMessage());
		}
	}

	private static double minimax(Node node, boolean maximize) {
		if (node.score != null) return node.score;
		if (node.children.isEmpty()) return 0;
		double best = maximize ? Double.NEGATIVE_INFINITY : Double.POSITIVE_INFINITY;
		for (Node child : node.children.values()) {
			double score = minimax(child, !maximize);
			best = maximize ? Math.max(best, score) : Math.min(best, score);
		}
		return best;
	}

	private static double evaluateFen(String fen, char perspective) {
		String[] fields = fen.split(" ");
		if (fields.length < 2) throw new IllegalArgumentException("Invalid FEN leaf");
		String[] ranks = fields[0].split("/");
		if (ranks.length != 8) throw new IllegalArgumentException("Invalid FEN board");
		double whiteScore = 0;
		for (int row = 0; row < ranks.length; row++) {
			int file = 0;
			for (char symbol : ranks[row].toCharArray()) {
				if (Character.isDigit(symbol)) {
					file += Character.digit(symbol, 10);
					continue;
				}
				char type = Character.toLowerCase(symbol);
				Integer value = PIECE_VALUES.get(type);
				if (value == null || file >= 8) throw new IllegalArgumentException("Invalid FEN piece placement");
				double sign = Character.isUpperCase(symbol) ? 1 : -1;
				double center = 3.5 - (Math.abs(3.5 - row) + Math.abs(3.5 - file)) / 2;
				double positional = type == 'p' ? (Character.isUpperCase(symbol) ? 6 - row : row - 1) * 5
					: type == 'n' || type == 'b' ? center * 7 : 0;
				whiteScore += sign * (value + positional);
				file++;
			}
			if (file != 8) throw new IllegalArgumentException("Invalid FEN rank width");
		}
		return perspective == 'w' ? whiteScore : -whiteScore;
	}

	private static void serveFile(HttpExchange exchange) throws IOException {
		if (!"GET".equals(exchange.getRequestMethod())) {
			exchange.getResponseHeaders().set("Allow", "GET");
			send(exchange, 405, "text/plain; charset=utf-8", "GET required");
			return;
		}
		String requested = exchange.getRequestURI().getPath();
		if (requested.isEmpty() || "/".equals(requested)) requested = "/chessgame.html";
		String fileName = switch (requested) {
			case "/chessgame.html" -> "chessgame.html";
			case "/chessgame.css" -> "chessgame.css";
			case "/chessgame.js" -> "chessgame.js";
			case "/stockfish-19-lite-single.js" -> "stockfish-19-lite-single.js";
			case "/stockfish-19-lite-single.wasm" -> "stockfish-19-lite-single.wasm";
			default -> null;
		};
		if (fileName == null) {
			send(exchange, 404, "text/plain; charset=utf-8", "Not found");
			return;
		}
		Path root = ROOT.toRealPath();
		Path file = root.resolve(fileName);
		if (!Files.isRegularFile(file)) {
			send(exchange, 404, "text/plain; charset=utf-8", "Not found");
			return;
		}
		file = file.toRealPath();
		if (!file.startsWith(root)) {
			send(exchange, 404, "text/plain; charset=utf-8", "Not found");
			return;
		}
		String contentType = switch (fileName) {
			case "chessgame.html" -> "text/html; charset=utf-8";
			case "chessgame.css" -> "text/css; charset=utf-8";
			case "chessgame.js" -> "text/javascript; charset=utf-8";
			case "stockfish-19-lite-single.js" -> "text/javascript; charset=utf-8";
			case "stockfish-19-lite-single.wasm" -> "application/wasm";
			default -> "application/octet-stream";
		};
		exchange.getResponseHeaders().set("X-Content-Type-Options", "nosniff");
		byte[] contents = Files.readAllBytes(file);
		exchange.getResponseHeaders().set("Content-Type", contentType);
		exchange.sendResponseHeaders(200, contents.length);
		try (var output = exchange.getResponseBody()) {
			output.write(contents);
		}
	}

	private static void send(HttpExchange exchange, int status, String contentType, String body) throws IOException {
		byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
		exchange.getResponseHeaders().set("Content-Type", contentType);
		exchange.sendResponseHeaders(status, bytes.length);
		try (var output = exchange.getResponseBody()) {
			output.write(bytes);
		}
	}
}
