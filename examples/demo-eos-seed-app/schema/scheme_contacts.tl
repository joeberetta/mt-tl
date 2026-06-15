---types---

contacts.link#3ace484c my_link:ContactLink foreign_link:ContactLink user:User = contacts.Link;

updateContactLink#9d2e67c5 user_id:int my_link:ContactLink foreign_link:ContactLink = Update;
updateContactsReset#7084a7be = Update;

---functions---

contacts.getContactIDs#2caa4a42 hash:int = Vector<int>;
contacts.getStatuses#c4a353ee = Vector<ContactStatus>;
contacts.getSaved#82f1e39f = Vector<SavedContact>;
