const crypto = require("crypto");

//some webserver libs
const express = require("express");
const bodyParser = require("body-parser");
const auth = require("basic-auth");

//promisification
const bluebird = require("bluebird");

//database connector
const redis = require("redis");
//make redis use promises
bluebird.promisifyAll(redis.RedisClient.prototype);
bluebird.promisifyAll(redis.Multi.prototype);
//create db client
const client = redis.createClient();

//make sure client connects correctly.
client.on("error", function(err) {
  console.log("Error in redis client.on: " + err);
});

//simple function to add a user and their credentials to the DB
const setUser = function(userObj) {
  return client
    .hmsetAsync("user:" + userObj.id, userObj)
    .then(function() {
      console.log("Successfully created (or overwrote) user " + userObj.id);
    })
    .catch(function(err) {
      console.error(
        "WARNING: errored while attempting to create tester user account"
      );
    });
};

//make sure the test user credentials exist
let userObj = {
  salt: new Date().toString(),
  id: "teacher"
};
userObj.hash = crypto
  .createHash("sha256")
  .update("testing" + userObj.salt)
  .digest("base64");
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
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );
  res.header("Access-Control-Expose-Headers", "X-Total-Count");
  next();
});

//protect our API
app.use(function(req, res, next) {
  switch (req.method) {
    case "GET":
    case "POST":
    case "PUT":
    case "DELETE":
      //extract the given credentials from the request
      let creds = auth(req);

      //look up userObj using creds.name
      client.hgetallAsync("user:" + creds.name).then(
        userObj => {
          //user exists
          //use creds.pass, userObj.salt, userObj.hash, and crypto to validate
          let testValid = crypto
            .createHash("sha256")
            .update(creds.pass + userObj.salt)
            .digest("base64");
          //whether the creds are valid. if they are valid call next();
          if (testValid === userObj.hash) {
            next();
          } else {
            //otherwise call res.sendStatus(401)
            res.sendStatus(401);
          }
        },
        err => {
          //user doesnt exist or something
          console.error(
            "in authenticate app.use, hgetall returned error: ",
            err
          );
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
let filterSortPaginate = (type, queryArgs, items) => {
  let keys;

  //create an array of filterable/sortable keys
  if (type == "student") {
    keys = ["id", "name"];
  } else {
    keys = ["id", "student_id", "type", "max", "grade"];
  }

  //applied to each item in items
  //returning true keeps item
  let filterer = item => {
    //loop through keys
    for (let i = 0; i < keys.length; i++) {
      //if a given key (like name) exists in the query args
      if (queryArgs[keys[i]] !== undefined) {
        //	and item[key] does NOT include the query args value (case insensitive)
        let arg = queryArgs[keys[i]];
        if (!item[keys[i]].toUpperCase().includes(arg.toUpperCase())) {
          //return false
          return false;
        }
      }
    }
    //if we get through the for loop return true

    return true;
  };

  //apply above function
  items = items.filter(filterer);

  console.log("items after filter:", items);

  //always sort, default to sorting on id
  if (!queryArgs._sort) {
    queryArgs._sort = "id";
  }
  //make sure the column can be sorted
  let direction = 1;
  if (!queryArgs._order) {
    queryArgs._order = "asc";
  }
  if (queryArgs._order.toLowerCase() == "desc") {
    direction = -1;
  }

  //comparator...given 2 items returns which one is greater
  //used to sort items
  let sorter = (a, b) => {
    //key to compare is in queryArgs._sort
    let theKey = queryArgs._sort;
    aKey = a[theKey];
    bKey = b[theKey];
    //idea taken from stack overflow
    if (theKey == "name" || theKey == "type") {
      aKey = aKey.toLowerCase();
      bKey = bKey.toLowerCase();
    } else if (theKey == "id" && type == "student") {
      aKey = aKey.toLowerCase();
      bKey = bKey.toLowerCase();
    }

    //make key variables to make it

    //if a[key] (lowercased) > b[key] (lowercased)
    if (aKey > bKey) {
      result = 1;
    } else if (aKey < bKey) {
      result = -1;
    } else {
      result = 0;
    }
    //	result = 1
    //if its less than, result = -1
    //else result = 0

    //multiply result by direction and return it
    return result * direction;
  };

  items.sort(sorter);
  console.log("items after sort:", items);
  //if we need to paginate
  if (queryArgs._start || queryArgs._end || queryArgs._limit) {
    //use queryArgs._start, _end, & limit
    //to figure out start and end
    //then items = items.slice(start,end)
    if (!queryArgs._start) {
      queryArgs._start = 0;
    }
    if (!queryArgs._end && queryArgs._limit) {
      queryArgs._end = queryArgs._start + queryArgs._limit;
    } else if (!queryArgs._end && !queryArgs._limit) {
      queryArgs._end = length(items);
    }
    items = items.slice(queryArgs._start, queryArgs._end);
  }
  console.log("items after pagination:", items);
  return items;
};

//TOdo

// post students
app.post("/students", function(req, res) {
  if (req.body !== undefined) {
    if (req.body.id !== undefined && req.body.name !== undefined) {
      let id = req.body.id;
      let name = req.body.name;
      client.sismember("students", id, function(err, reply) {
        if (reply === 1) {
          res.sendStatus(400);
        } else {
          let userObj = {
            id: id,
            name: name,
            _ref: "/students/" + id
          };
          let JSONUserObj = JSON.stringify(userObj);
          client.sadd("students", id);
          client.hset("student:" + id, "obj", JSONUserObj);
          let response = JSONUserObj;
          res.status(200).send(response);
        }
      });
    } else {
      res.sendStatus(400);
    }
  } else {
    res.sendStatus(400);
  }
});

//delete them students
app.delete("/students/:id", function(req, res) {
  if (req.params.id !== undefined) {
    let id = req.params.id;
    client.sismember("students", id, function(err, reply) {
      if (reply === 1) {
        client.srem("students", id);
        client.hdel("student:" + id, "obj");
        let response = JSON.stringify({
          id: id
        });
        res.status(200).send();
      } else {
        res.sendStatus(404);
      }
    });
  } else {
    res.sendStatus(400);
  }
});

//PUT STUDENTS/:id
app.put("/students/:id", function(req, res) {
  if (
    req.params.id !== undefined &&
    req.body !== undefined &&
    req.body.id === undefined &&
    req.body.name !== undefined
  ) {
    let id = req.params.id;
    let name = req.body.name;
    let userObj = {
      id: id,
      name: name,
      _ref: "/students/" + id
    };
    let userObjJSON = JSON.stringify(userObj);

    client.hset("student:" + id, "obj", userObjJSON);
    res.status(200).send(userObjJSON);
  } else if (
    req.body === undefined ||
    req.params.id !== undefined ||
    req.body.name === undefined
  ) {
    res.sendStatus(400);
  } else {
    res.sendStatus(404);
  }
});

//GET STUDENTS/:id
app.get("/students/:id", function(req, res) {
  if (req.params.id !== undefined) {
    let id = req.params.id;

    client.sismember("students", id, function(err, reply) {
      if (reply === 1) {
        client.hget("student:" + id, "obj", function(err, reply) {
          let name = JSON.parse(reply).name;
          let response = reply;
          res.status(200).send(response);
        });
      } else {
        res.sendStatus(404);
      }
    });
  } else {
    res.sendStatus(404);
  }
});

//GET STUDENTS
app.get("/students", function(req, res) {
  client
    .smembersAsync("students")
    .then(students => {
      let users = [];
      let promises = [];
      for (let i = 0; i < students.length; i++) {
        let id = students[i];
        let x = client.hgetallAsync("student:" + id).then(userObj => {
          if (userObj !== undefined) {
            users.push(JSON.parse(userObj.obj));
          }
        });
        promises.push(x);
      }
      return Promise.all(promises).then(() => users);
    })
    .then(users => {
      res.header("X-Total-Count", users.length);
      users = filterSortPaginate("student", req.query, users);
      res
        .status(200)
        .json(users)
        .end();
    });
});

//POST GRADES
app.post("/grades", function(req, res) {
  if (
    req.body !== undefined &&
    req.body.student_id !== undefined &&
    req.body.type !== undefined &&
    req.body.max !== undefined &&
    req.body.grade !== undefined
  ) {
    client.get("grades", function(err, reply) {
      let num = reply;
      num++;
      let gradeObj = req.body;
      gradeObj._ref = "/grades/" + num;
      gradeObj.id = num;
      let gradeObjJSON = JSON.stringify(gradeObj);

      console.log();
      console.log(gradeObj);
      console.log();

      //id is expected to be a string
      gradeObj.id = gradeObj.id.toString();

      client.set("grades", num);
      client.hset("grade:" + num, "obj", gradeObjJSON);

      gradeObjJSON = JSON.stringify(gradeObj);

      res.status(200).send(gradeObjJSON);
      console.log(gradeObjJSON);
    });
  } else {
    res.sendStatus(400);
  }
});

//GET GRADES/:id
app.get("/grades/:id", function(req, res) {
  if (req.params.id !== undefined) {
    let id = req.params.id;

    client.hget("grade:" + id, "obj", function(err, reply) {
      if (reply !== null) {
        let gradeObj = JSON.parse(reply);
        let gradeObjJSON = reply;
        res.status(200).send(gradeObjJSON);
      } else {
        res.sendStatus(404);
      }
    });
  } else {
    res.sendStatus(404);
  }
});

//PUT GRADES/:id
app.put("/grades/:id", function(req, res) {
  if (req.params.id !== undefined && req.body !== undefined) {
    let id = req.params.id;
    client.hget("grade:" + id, "obj", function(err, reply) {
      if (reply !== null) {
        let gradeObj = JSON.parse(reply);

        if (req.body.student_id !== undefined) {
          gradeObj.student_id = req.body.student_id;
        }
        if (req.body.type !== undefined) {
          gradeObj.type = req.body.type;
        }
        if (req.body.grade !== undefined) {
          gradeObj.grade = req.body.grade;
        }
        if (req.body.max !== undefined) {
          gradeObj.max = req.body.max;
        }

        let gradeObjJSON = JSON.stringify(gradeObj);

        client.hset("grade:" + id, "obj", gradeObjJSON);
        res.sendStatus(200);
      } else {
        res.sendStatus(400);
      }
    });
  } else if (req.params.id !== undefined) {
    res.sendStatus(404);
  } else {
    res.sendStatus(400);
  }
});

//DELETE GRADES/:id
app.delete("/grades/:id", function(req, res) {
  if (req.params.id !== undefined) {
    let id = req.params.id;

    client.hexists("grade:" + id, "obj", function(err, reply) {
      if (reply === 1) {
        client.hdel("grade:" + id, "obj", function(err, reply) {
          res.sendStatus(200);
        });
      } else {
        res.sendStatus(404);
      }
    });
  } else {
    res.sendStatus(404);
  }
});

//GET GRADES
app.get("/grades", function(req, res) {
  client
    .getAsync("grades")
    .then(num => {
      let grades = [];
      let promises = [];

      for (let i = 0; i <= num; i++) {
        let promise = client.hgetallAsync("grade:" + i).then(gradeObjJSON => {
          if (gradeObjJSON !== undefined && gradeObjJSON !== null) {
            grades.push(JSON.parse(gradeObjJSON.obj));
          }
        });
        promises.push(promise);
      }
      return Promise.all(promises).then(() => grades);
    })
    .then(grades => {
      res.header("X-Total-Count", grades.length);
      grades = filterSortPaginate("grade", req.query, grades);

      //max is expected to be a string
      for (let i = 0; i < grades.length; i++) {
        grades[i].max = grades[i].max.toString();
      }

      res
        .status(200)
        .json(grades)
        .end();
    });
});

//DELETE DB
app.delete("/db", function(req, res) {
  client
    .flushallAsync()
    .then(function() {
      //make sure the test user credentials exist
      let userObj = {
        salt: new Date().toString(),
        id: "teacher"
      };
      userObj.hash = crypto
        .createHash("sha256")
        .update("testing" + userObj.salt)
        .digest("base64");
      //this is a terrible way to do setUser
      //I'm not waiting for the promise to resolve before continuing
      //I'm just hoping it finishes before the first req.body comes in attempting to authenticate
      setUser(userObj).then(() => {
        res.sendStatus(200);
      });
      client.set("grades", 0);
    })
    .catch(function(err) {
      res.status(500).json({
        error: err
      });
    });
});

//catch errors, turn off db?
//generalized error handler
const dbErrorHandler = res => err =>
  console.error("DB Error: ", err) &&
  res
    .status(500)
    .json(err)
    .end();

let port = 3000;
app.listen(port, function() {
  console.log("Proj 5 listening on port " + port + "!");
});
