/* Plus Mídia — funnel tracker (first-party, sem PII). Grava etapas no Supabase via anon. */
(function(){
  var SUPA='https://rkngilknpcibcwalropj.supabase.co';
  var ANON='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJrbmdpbGtucGNpYmN3YWxyb3BqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE2NTEzOTUsImV4cCI6MjA3NzIyNzM5NX0.b_TCn2hsU8UPFvqGnXzzKhJApm9NVMxqxxNAOHyNsdQ';
  function sid(){
    try{var s=localStorage.getItem('dg_sid');if(!s){s=Date.now().toString(36)+Math.random().toString(36).slice(2,10);localStorage.setItem('dg_sid',s);}return s;}
    catch(e){return 'ns_'+Math.random().toString(36).slice(2,10);}
  }
  window.dgTrack=function(step,idx,meta){
    try{
      fetch(SUPA+'/rest/v1/lp_funnel_events',{method:'POST',keepalive:true,
        headers:{'apikey':ANON,'Authorization':'Bearer '+ANON,'Content-Type':'application/json','Prefer':'return=minimal'},
        body:JSON.stringify({session_id:sid(),source:'quiz-diagnostico',step:step,step_index:(idx===undefined||idx===null?null:idx),meta:meta||{}})
      }).catch(function(){});
    }catch(e){}
  };
})();
