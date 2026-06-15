---types---

serviceAccountType#116b8df4 service:string = ServiceAccountType;

userEmpty#200250ba id:int = User;
userService#0bab9d5d flags:# id:int self:flags.0?true contact:flags.1?true type:ServiceAccountType first_name:flags.2?string last_name:flags.3?string username:flags.4?string email:string eos_name:string photo:UserProfilePhoto access_hash:long = User;
userUnreged#d5d91b9d flags:# id:int contact:flags.0?true first_name:flags.1?string last_name:flags.2?string phone:flags.3?string access_hash:long = User;
user#9c6fda0f flags:# id:int self:flags.0?true contact:flags.1?true mutual_contact:flags.2?true blocked:flags.3?true verified:flags.4?true buisness:flags.5?true first_name:flags.6?string last_name:flags.7?string username:flags.8?string phone:flags.9?string email:string eos_name:string photo:UserProfilePhoto subscriptions:flags.10?subscriptions.CommonInfo lang_code:flags.11?string access_hash:long kyc_verifed:int has_unionpay_account:flags.12?true status:flags.13?UserStatus = User;

// TODO: надо бы уже дропнуть
// Когда 117-ая версия станет минимальной - дропать отсюда
subscriptions.commonInfo#a3d8ab1e am_i_follower:Bool is_my_follower:Bool followers_count:int followings_count:int = subscriptions.CommonInfo;

userFull#745559cc flags:# blocked:flags.0?true phone_calls_available:flags.4?true phone_calls_private:flags.5?true can_pin_message:flags.7?true user:User about:flags.1?string link:contacts.Link profile_photo:flags.2?Photo notify_settings:PeerNotifySettings bot_info:flags.3?BotInfo pinned_msg_id:flags.6?int common_chats_count:int folder_id:flags.11?int = UserFull;

updateUserBlockData#85ccf2d8 user_block_data:crypto.UserBlockData = Update;

inputUserEmpty#b98886cf = InputUser;
inputUserSelf#f7c1b13f = InputUser;
inputUser#d8292816 user_id:int access_hash:long = InputUser;
inputUserSupport#8bb8ba60 = InputUser;

updateUserStatus#1bfbd823 user_id:int status:UserStatus = Update;
updateUserName#a7332b73 user_id:int first_name:string last_name:string username:string = Update;
updateUserBlocked#80ece81a user_id:int blocked:Bool = Update;
updateUserPhone#12b9417b user_id:int phone:string = Update;

---functions---

users.getUsers#d91a548 id:Vector<InputUser> = Vector<User>;
users.getFullUser#ca30a5b1 id:InputUser = UserFull;
