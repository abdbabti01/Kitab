import type {Chapter} from "./curated";

export function validateLessons(lessons:Chapter[]){
 const errors:string[]=[];
 const slugs=new Set<string>();
 for(const lesson of lessons){
  if(!lesson.slug||slugs.has(lesson.slug))errors.push(`Invalid or duplicate lesson id: ${lesson.slug||"missing"}`);
  slugs.add(lesson.slug);
  if(!lesson.title.trim())errors.push(`${lesson.slug}: missing title`);
  if(lesson.steps.length<3)errors.push(`${lesson.slug}: a guided lesson needs at least three scenes`);
  const ids=new Set<string>();
  lesson.steps.forEach((scene,index)=>{
   const id=`${index}-${scene.title}`;
   if(!scene.title.trim()||!scene.detail.trim()||!scene.state.trim())errors.push(`${lesson.slug}: incomplete scene ${index+1}`);
   if(ids.has(id))errors.push(`${lesson.slug}: duplicate scene ${index+1}`);
   ids.add(id);
  });
 }
 return errors;
}
