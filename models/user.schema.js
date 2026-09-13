const mongoose = require("mongoose");


const model = new mongoose.Schema({
    name: String,
    email: String,
    password: String,
    role: String,
    createdAt: Date,
    updatedAt: Date,
});

userSchema.find({
   orders:{
    
   }
})

module.exports = mongoose.model("User", model);

