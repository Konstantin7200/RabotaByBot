
const memcache=new Map<string,number>();

export function setToMemcache(key:string,value:number){
    memcache.set(key,value);
}
export function getFromMemcache(key:string){
    return memcache.get(key);
}