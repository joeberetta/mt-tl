---types---

updatesTooLong#e317af7e = Updates;
updateShort#78d4dec1 update:Update date:int = Updates;
updatesCombined#725b04c3 updates:Vector<Update> users:Vector<User> chats:Vector<Chat> date:int seq_start:int seq:int = Updates;
updates#74ae4240 updates:Vector<Update> users:Vector<User> chats:Vector<Chat> date:int seq:int = Updates;

updates.state#a56c2a3e pts:int qts:int date:int seq:int unread_count:int = updates.State;

updates.differenceEmpty#5d75a138 date:int seq:int = updates.Difference;
updates.difference#00f49ca0 new_messages:Vector<Message> new_encrypted_messages:Vector<EncryptedMessage> other_updates:Vector<Update> chats:Vector<Chat> users:Vector<User> state:updates.State = updates.Difference;
updates.differenceSlice#a8fb1981 new_messages:Vector<Message> new_encrypted_messages:Vector<EncryptedMessage> other_updates:Vector<Update> chats:Vector<Chat> users:Vector<User> intermediate_state:updates.State = updates.Difference;
updates.differenceTooLong#4afe8f6d pts:int = updates.Difference;

updatePtsChanged#3354678f = Update;

---functions---

updates.getState#edd4882a = updates.State;
updates.getDifference#25939651 flags:# pts:int pts_total_limit:flags.0?int date:int qts:int = updates.Difference;
