const crypto = require('crypto'); 

//some webserver libs
const express = require('express');
const bodyParser = require('body-parser');
const auth = require('basic-auth');

//promisification
const bluebird = require('bluebird');

//database connector
const redis = require('redis');
//make redis use promises
bluebird.promisifyAll(redis.RedisClient.prototype);
bluebird.promisifyAll(redis.Multi.prototype);
//create db client
const client = redis.createClient();

//make sure client connects correctly.
client.on("error", function (err) {
    console.log("Error in redis client.on: " + err);
});

//simple function to add a user and their credentials to the DB
const setUser = function(userObj){
	return client.hmsetAsync("user:"+userObj.id, userObj ).then(function(){
		console.log('Successfully created (or overwrote) user '+userObj.id);
	}).catch(function(err){
		console.error("WARNING: errored while attempting to create tester user account");
	});

}

//make sure the test user credentials exist
let userObj = {
	salt: new Date().toString(),
	id: 'teacher'
};
userObj.hash = crypto.createHash('sha256').update('testing'+userObj.salt).digest('base64');
//this is a terrible way to do setUser
//I'm not waiting for the promise to resolve before continuing
//I'm just hoping it finishes before the first request comes in attempting to authenticate
setUser(userObj);


//start setting up webserver
const app = express();

//decode request body using json
app.use(bodyParser.json());

//allow the API to be loaded from an application running on a different host/port
app.use(function(req, res, next) {
        res.header("Access-Control-Allow-Origin", "*");
        res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
        res.header('Access-Control-Expose-Headers', 'X-Total-Count');
        next();
});

//protect our API
app.use(function(req,res,next){
	switch(req.method){
		case "GET":
		case "POST":
		case "PUT":
		case "DELETE":
			//extract the given credentials from the request
			let creds = auth(req);
			
			//look up userObj using creds.name
			client.hgetallAsync("user:"+creds.name).then(
				(userObj)=>{
					//user exists
					
					//TODO
					//use creds.pass, userObj.salt, userObj.hash, and crypto to validate
					//whether the creds are valid. if they are valid call next();
					//otherwise call res.sendStatus(401)
					
				},
				(err)=>{
					//user doesnt exist or something
					console.error("in authenticate app.use, hgetall returned error: ",err);
					res.sendStatus(401);
				}
			);
			break;
		default:
			//maybe an options check or something
			next();
			break;
	}
});

//this takes a set of items and filters, sorts and paginates the items.
//it gets it's commands from queryArgs and returns a new set of items
//used like
//	listOfStudents = filterSortPaginate('student', req.query, listOfStudents)
let filterSortPaginate = (type, queryArgs, items) =>{
	let keys;

	//create an array of filterable/sortable keys
	if(type == 'student'){
		keys = ['id','name'];
	}else{
		keys = ['id','student_id','type','max','grade'];
	}

	//applied to each item in items
	//returning true keeps item
	let filterer = (item) =>{
		//TODO
		//loop through keys
		//if a given key (like name) exists in the query args
		//	and item[key] does NOT include the query args value (case insensitive)
		//	return false
		//if we get through the for loop return true

		//example: if queryArgs['name'] = 'cra'
		//and item['name'] = 'Craig B'
		//return true 
	};

	//apply above function
	items = items.filter(filterer);
	
	console.log('items after filter:',items)
	
	//always sort, default to sorting on id
	if(!queryArgs._sort){
		queryArgs._sort = 'id';
	}
	//make sure the column can be sorted
	let direction = 1;
	if(!queryArgs._order){
		queryArgs._order = 'asc';
	}
	if(queryArgs._order.toLowerCase() == 'desc'){
		direction = -1;
	}

	//comparator...given 2 items returns which one is greater
	//used to sort items
	let sorter = (a,b)=>{
		//TODO 
		//key to compare is in queryArgs._sort
		//if a[key] (lowercased) > b[key] (lowercased)
		//	result = 1
		//if its less than, result = -1
		//else result = 0
		
		//multiply result by direction and return it
	};

	items.sort(sorter);
	console.log('items after sort:',items)
	//if we need to paginate
	if(queryArgs._start || queryArgs._end || queryArgs._limit){
		//TODO
		//use queryArgs._start, _end, & limit
		//to figure out start and end 
		//then items = items.slice(start,end)
		
		//start defaults to 0, end defaults to # of items
	}
	console.log('items after pagination:',items)
	return items;
};

//TODO

let port = 3000;
app.listen(port, function () {
  console.log('Proj 5 listening on port '+port+'!');
});