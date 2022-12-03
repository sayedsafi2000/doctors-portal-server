const express = require('express');
const cors = require('cors');
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
require("dotenv").config();
const app = express();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)


//middleware
app.use(cors());
app.use(express.json());

app.get("/", async (req, res) => {
    res.send("Doctors-portal-running")
});


//mongodb server


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ldps5dz.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

async function verifyJWT(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send("Unauthorised access")
    }
    const token = authHeader.split(" ")[1];
    jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: "forbidden access" })
        }
        req.decoded = decoded;
        next();
    })
}


async function run() {

    try {
        const appoinmentOptionCollection = client.db("doctors-portal").collection("appoinmentOption");
        const bookingsCollection = client.db("doctors-portal").collection("bookings");
        const usersCollection = client.db("doctors-portal").collection("users");
        const doctorsCollection = client.db("doctors-portal").collection("doctors");
        const paymentsCollection = client.db("doctors-portal").collection("payments");


        // Admin middleware 
        const verifyAdmin = async (req, res, next) => {
            const decodedEmail = req.decoded.email;
            const query = { email: decodedEmail };
            const user = await usersCollection.findOne(query);
            if (user?.role !== "admin") {
                return res.status(403).send({ message: "Forbidden Access bro" })
            }
            next();
        }



        app.get("/appoinmentOption", async (req, res) => {
            const date = req.query.date;
            console.log(date)
            const query = {};
            const options = await appoinmentOptionCollection.find(query).toArray();
            const bookingQuery = { appoinmentDate: date }
            const alreadybooked = await bookingsCollection.find(bookingQuery).toArray();
            // console.log(alreadybooked)

            options.forEach(option => {
                const optionbooked = alreadybooked.filter(book => book.treatment === option.name)
                // console.log(optionbooked)
                const bookedSlots = optionbooked.map(book => book.slot);
                const remainingSlots = option.slots.filter(slot => !bookedSlots.includes(slot));
                option.slots = remainingSlots;
            })
            res.send(options)
        });

        app.get("/appoinmentSpecialty", async (req, res) => {
            const query = {}
            const result = await appoinmentOptionCollection.find(query).project({ name: 1 }).toArray();
            res.send(result)
        })

        app.get("/bookings", verifyJWT, async (req, res) => {
            const email = req.query.email;
            const decodedEmail = req.decoded.email;
            if (email !== decodedEmail) {
                return res.status(403).send({ message: "forbidden access" })
            }
            const query = { email: email };
            const bookings = await bookingsCollection.find(query).toArray();

            res.send(bookings)
        })

        app.post("/bookings", async (req, res) => {
            const booking = req.body;
            console.log(booking);
            const query = {
                appoinmentDate: booking.appoinmentDate,
                email: booking.email,
                treatment: booking.treatment
            };

            const alreadyBooked = await bookingsCollection.find(query).toArray();

            if (alreadyBooked.length) {
                const message = `You already have a booking on ${booking.appoinmentDate}`
                return res.send({ acknowledged: false, message })
            }
            const result = await bookingsCollection.insertOne(booking);
            res.send(result)
        });

        app.get("/bookings/:id", async (req, res) => {
            const id = req.params.id;
            const query = ({ _id: ObjectId(id) })
            const booking = await bookingsCollection.findOne(query)
            res.send(booking)
        });

        app.post("/create-payment-intent", async (req, res) => {
            const booking = req.body;
            const price = booking.price;
            const amount = price * 100;

            const paymentIntent = await stripe.paymentIntents.create({
                currency: 'usd',
                amount: amount,
                "payment_method_types": [
                    "card"
                ]
            })
            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        });

        app.post("/payments",async(req,res)=>{
            const payment = req.body;
            const result = await paymentsCollection.insertOne(payment);
            const id = payment.bookingId;
            const filter = {_id: ObjectId(id)}
            const updatedDoc = {
                $set:{
                    paid: true,
                    transcationId:payment.transcationId
                }
            }
            const updatedResult = await bookingsCollection.updateOne(filter,updatedDoc)
            res.send(result);
        })

        app.get("/jwt", async (req, res) => {
            const email = req.query.email;
            const query = { email: email };
            const user = await usersCollection.findOne(query);
            if (user) {
                const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, { expiresIn: "1h" });
                return res.send({ accessToken: token })
            }
            console.log(user)
            res.status(403).send({ accessToken: "" })
        });
        app.get("/users", async (req, res) => {
            const query = {};
            const users = await usersCollection.find(query).toArray();
            res.send(users)
        })
        app.post("/users", async (req, res) => {
            const user = req.body;
            const result = await usersCollection.insertOne(user);
            res.send(result);
        });
        app.get('/users/admin/:email', async (req, res) => {
            const email = req.params.email;
            const query = { email }
            const user = await usersCollection.findOne(query);
            res.send({ isAdmin: user?.role === "admin" });
        })

        app.put("/users/admin/:id", verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: ObjectId(id) };
            const options = { upsert: true };
            const updatedDoc = {
                $set: {
                    role: "admin"
                }
            }
            const result = await usersCollection.updateOne(filter, updatedDoc, options);
            res.send(result);
        });

        // app.get("/addPrice", async (req, res) => {
        //     const filter = {};
        //     const options = { upsert: true }
        //     const updatedDoc = {
        //         $set: {
        //             price: 99
        //         }
        //     }
        //     const result =await appoinmentOptionCollection.updateMany(filter,updatedDoc,options)
        //     res.send(result)
        // })

        app.get("/doctors", verifyJWT, verifyAdmin, async (req, res) => {
            const query = {};
            const doctors = await doctorsCollection.find(query).toArray();
            res.send(doctors);
        });
        app.delete("/doctors/:id", verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = ({ _id: ObjectId(id) })
            const result = await doctorsCollection.deleteOne(query);
            if (result.deletedCount === 1) {
                console.log("Successfully deleted one document.");
            } else {
                console.log("No documents matched the query. Deleted 0 documents.");
            }
            res.send(result)
        })
        app.post("/doctors", verifyJWT, verifyAdmin, async (req, res) => {
            const doctor = req.body;
            const result = await doctorsCollection.insertOne(doctor);
            res.send(result)
        })

    }
    finally {

    }


}
run().catch(console.log)



app.listen(port, () => console.log(`"doctors-portal-running port ${port}`));