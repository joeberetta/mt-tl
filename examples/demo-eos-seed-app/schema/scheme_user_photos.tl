---types---

userProfilePhotoEmpty#affe6ca0 flags:# color_id:flags.0?string = UserProfilePhoto;
userProfilePhoto#005ccac9 photo_id:long photo_small:FileLocation photo_big:FileLocation dc_id:int url:string = UserProfilePhoto;

updateUserPhoto#95313b0c user_id:int date:int photo:UserProfilePhoto previous:Bool = Update;

---functions---
photos.deletePhotos#87cf7f2f id:Vector<InputPhoto> = Vector<long>;
