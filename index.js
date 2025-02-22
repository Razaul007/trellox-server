require("dotenv").config();
const express = require("express");
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const port = process.env.PORT || 9000;
const app = express();

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.IO
const io = new Server(server, { cors: { origin: "http://localhost:5173" } });

// Middleware
app.use(
  cors({
    origin: ["http://localhost:5173"],
    credentials: true,
  })
);
app.use(express.json());

// Token verification
const verifyJWT = (req, res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization) {
    return res.status(401).send({ message: "No Token!" });
  }
  const token = authorization.split(' ')[1];
  jwt.verify(token, process.env.ACCESS_KEY_TOKEN, (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: "Invalid token!" });
    }
    req.decoded = decoded;
    next();
  });
};

// JWT
app.post("/jwt", async (req, res) => {
  const userEmail = req.body;
  const token = jwt.sign(userEmail, process.env.ACCESS_KEY_TOKEN, { expiresIn: '10d' });
  res
    .cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production", // Use secure cookies in production
    })
    .send({ success: true });
});

// MongoDB connection
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.tqqmmai.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let db, userCollection, taskCollection;

// Connect to MongoDB
async function connectDB() {
  try {
    await client.connect();
    db = client.db("trellox");
    userCollection = db.collection("users");
    taskCollection = db.collection("tasks");
    console.log("Connected to MongoDB");
  } catch (err) {
    console.error("MongoDB Connection Error:", err);
    process.exit(1); // Exit the process if the connection fails
  }
}
connectDB();

// Socket.IO connection with authentication
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    return next(new Error("Authentication error: No token provided"));
  }
  jwt.verify(token, process.env.ACCESS_KEY_TOKEN, (err, decoded) => {
    if (err) {
      return next(new Error("Authentication error: Invalid token"));
    }
    socket.decoded = decoded;
    next();
  });
});

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);
  socket.on("disconnect", () => console.log("User disconnected:", socket.id));
});

// Save a new user
app.post("/users", async (req, res) => {
  try {
    const user = req.body; // Assuming the request body contains user data (e.g., name, email, password)

    // Check if the user already exists
    const existingUser = await userCollection.findOne({ email: user.email });
    if (existingUser) {
      return res.status(400).json({ error: "User already exists" });
    }

    // Insert the new user into the database
    const result = await userCollection.insertOne(user);
    res.status(201).json({ message: "User created successfully", userId: result.insertedId });
  } catch (err) {
    console.error("Error saving user:", err);
    res.status(500).json({ error: "Failed to save user" });
  }
});

// Routes
app.get("/tasks",  async (req, res) => {
  try {
    const tasks = await taskCollection.find().toArray();
    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch tasks" });
  }
});

app.post("/tasks",  async (req, res) => {
  try {
    const task = { ...req.body, timestamp: new Date() };
    // console.log(task)
    const result = await taskCollection.insertOne(task);
    const newTask = { ...task, _id: result.insertedId };

    io.emit("taskAdded", newTask);
    res.json(newTask);
  } catch (err) {
    res.status(500).json({ error: "Failed to add task" });
  }
});

app.put("/tasks/:id", async (req, res) => {
  try {
    const { id } = req.params;
    // console.log(id)
    await taskCollection.updateOne({ _id: new ObjectId(id) }, { $set: req.body });

    io.emit("taskUpdated", { id, ...req.body });
    res.json({ message: "Task updated" });
  } catch (err) {
    res.status(500).json({ error: "Failed to update task" });
  }
});

app.delete("/tasks/:id",  async (req, res) => {
  try {
    const { id } = req.params;
    console.log(id)
    await taskCollection.deleteOne({ _id: new ObjectId(id) });

    io.emit("taskDeleted", id);
    res.json({ message: "Task deleted" });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete task" });
  }
});

// Root route
app.get("/", (req, res) => {
  res.send("Hello from Trellox Server..");
});

// Start server
server.listen(port, () => {
  console.log(`Trellox is running on port ${port}`);
});