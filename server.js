var http = require('http');
var url = require('url');
var fs = require('fs');
var mongo = require('mongodb');
var monk = require('monk');
var db = monk("localhost:27017/privatechat");
var collection;
var chatCollection;
var messageCollection;
var server;

server = http.createServer(function(req, res){
    // your normal server code
    var path = url.parse(req.url).pathname;
    switch (path){
        case '/':
            fs.readFile(__dirname + path+"index.html", function(err, data){
                if (err){ 
                    return send404(res);
                }
                res.writeHead(200, {'Content-Type': path == 'json.js' ? 'text/javascript' : 'text/html'});
                res.write(data, 'utf8');
                res.end();
            });
        break;
        default: send404(res);
    }
}),

send404 = function(res){
    res.writeHead(404);
    res.write('404');
    res.end();
};

server.listen(8001);

// use socket.io
var io = require('socket.io').listen(server);


//turn off debug by 1
io.set('log level', 0);



// define interactions with client
io.sockets.on('connection', function(socket){

    socket.username = "";

    socket.on('createUser',function(data){

        collection = db.get('users');
        socket.username = data.username;
        collection.findOne({username:data.username},function(err,result){
            if(err)
            {
                console.log("Could not connect to server");
            }
            if(result)
            {
                collection.update({username:socket.username}, {$set:{status:1}}, function(err, result) {
                    if (err)
                    {
                        console.log('status not updated');
                    }
                    if(result)
                    {
                        console.log(socket.username+" connect");
                        getUserList(socket.username);
                        getFriendsList(socket.username);
                    }
                });
            }
            else
            {
                console.log('new user');
                collection.insert({
                    'username':data.username,
                    'status':1,
                    'friends':[],
                    'created_at': new Date(),
                    'last_online':0
                });
                socket.username = data.username;
                getUserList(socket.username);
                getFriendsList(socket.username);
            }
        });

    });

    //getting user method
    function getUserList(mainuser)
    {
       //console.log('user getting...');
        collection.find({username:{$ne:mainuser}},function(error,userlist){
            if(error)
            {
                console.log('Could not connect to collection');
            }
            if(userlist)
            {
                //console.log('sending user details...');
                
                socket.emit('userlist',{userlist:userlist,mainuser:mainuser});
            }
        }); 
    }

    //getting friends method
    function getFriendsList(mainuser)
    {
       //console.log('user getting...');
        collection.find({username:mainuser},function(error,frndlist){
            if(error)
            {
                console.log('Could not connect to collection');
            }
            if(frndlist)
            {
                //console.log('sending user details...');
                
                socket.emit('frndlist',{frndlist:frndlist,mainuser:mainuser});
            }
        }); 
    }

    socket.on('instanceUserStatus',function(data){
        getUserList(data.username);
        getFriendsList(socket.username);
    });

    socket.on('disconnect', function(){
        //console.log(socket.username);
        if(socket.username != '' || socket.username != null)
        {
        collection.update({$and:[{username:socket.username},{"friends.connection":1}]},{$set:{"friends.$.connection":0}},{upsert:true,multi:true});
        collection.update({username:socket.username}, {$set:{status:0,'last_online': new Date()}}, function(err, result) {
        if (err)
        {
            console.log('status not updated');
        }
        if(result)
        {
            getUserList(socket.username);
            getFriendsList(socket.username);
            console.log(socket.username+" disconnect");
        }
        });
        }
    });

    //for create chatList Table
    socket.on('createChatList',function(data){
        chatCollection = db.get('chatList');
        messageCollection = db.get('messageList');
        var chat_id;
        var frndChat_id;

        //collection.find({username:data.chat1},function(error,resu){
        collection.find({$and:[{username:data.chat1},{"friends.name":data.chat2}]},function(error,resu){
            if(error)
            {
                console.log("error while checking the friends list");

            }
            if(resu.length)
            {
                
                for(frnd = 0;frnd < resu[0].friends.length; frnd++)
                {
                    if(resu[0].friends[frnd].name == data.chat2)
                    {
                        frndChat_id = resu[0].friends[frnd].chat_id;
                    }
                }
                
                socket.join(frndChat_id);
                collection.update({$and:[{username:socket.username},{"friends.connection":1}]},{$set:{"friends.$.connection":0}},{upsert:true,multi:true});
                collection.update({$and:[{username:socket.username},{"friends.chat_id":frndChat_id}]},{$set:{"friends.$.connection":1,"friends.$.notification":0}},{upsert:true,multi:true});

                messageCollection.find({chat_id:frndChat_id},function(error,result){
                    socket.emit('chatmessages',{
                        'chatmessages':result,
                        'frndname' : data.chat2
                    });
                });
                //console.log(io['sockets']['adapter']['rooms']);
                //console.log(socket.username);

            }
            else
            {
                chatCollection.insert(data,function(err,doc){
                    chat_id = doc._id.toString();
                    //io['sockets']['adapter']['rooms'] = [];
                    socket.join(chat_id);
                    messageCollection.insert({'chat_id':chat_id,'message':[]});
                    addFriend = {name: data.chat2,chat_id:chat_id,lastMsg:'',lastMsgTime:'',notification:'',connection:1};
                    addedFriend = {name: data.chat1,chat_id:chat_id,lastMsg:'',lastMsgTime:'',notification:'',connection:0};


                    collection.update({username:data.chat1},{$push:{friends:addFriend}});
                    collection.update({username:data.chat2},{$push:{friends:addedFriend}});
                });
            }
            
        });

    });
    
    socket.on('saveMessage',function(data){
        message = {sender:data.sender,content:data.msgContent};
        messageCollection.update({chat_id : data.chat_id},{$push:{message:message}});
        
        collection.findOne({$and:[{username:data.receiver},{friends:{$elemMatch:{chat_id:data.chat_id}}}]},function(error,dataStatus){
            if(dataStatus)
            {
                for(i = 0;i < dataStatus.friends.length; i++)
                {
                    if(dataStatus.friends[i].chat_id == data.chat_id)
                    {
                        if(dataStatus.friends[i].connection == 0)
                        {
                            collection.update({$and:[{username:data.receiver},{"friends.chat_id":data.chat_id}]},{$inc:{"friends.$.notification":1}},{upsert:true,multi:true});
                            console.log("connection = 0");
                        }
                    }
                }
            }
        });
        collection.update({"friends.chat_id":data.chat_id},{$set:{"friends.$.lastMsg":data.msgContent,"friends.$.lastMsgTime":new Date()}},{multi:true});
        //io.sockets.to(data.chat_id).emit('newMessage',{
        io.sockets.in(data.chat_id).emit('newMessage',{
            'sender' : data.sender,
            'content' : data.msgContent,
            'receiver' : data.receiver
        });
    });

});
