import json, sys
from pathlib import Path
import numpy as np, soundfile as sf
from scipy import signal
NOTES=["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"]
# Krumhansl-Kessler key profiles
MAJOR=[6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88]
MINOR=[6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17]
LOW_BAND_HZ=150.0
BEATS_PER_BAR,BARS_PER_PHRASE=4,4
ON_BEAT_TOL,DENSITY_RADIUS,SMOOTH_RADIUS,SHAPE_THRESHOLD=0.07,1.0,0.5,0.1
def _mean(v): return float(np.mean(v)) if len(v) else 0.0
def _circ(t,phase,period):
    r=(t-phase)%period
    return min(r,period-r)
def estimate_key(chn):
    if not any(v>0 for v in chn): return None
    scores=[]
    for mode,prof in (("major",MAJOR),("minor",MINOR)):
        for tonic in range(12):
            rot=[prof[(i-tonic)%12] for i in range(12)]
            scores.append((tonic,mode,float(np.corrcoef(chn,rot)[0,1])))
    order=sorted(range(len(scores)),key=lambda i:(-scores[i][2],i))
    b,s=scores[order[0]],scores[order[1]]
    return {"tonic":NOTES[b[0]],"mode":b[1],"label":f"{NOTES[b[0]]} {b[1]}","confidence":round(b[2],4),"runner_up":f"{NOTES[s[0]]} {s[1]}"}
PHASE_TIE_EPS=1e-9
def beat_grid(bpm,ons,dur,low,hop_sec):
    if bpm<=0 or len(ons)<2 or len(low)==0: return None
    beat=60.0/bpm
    phase,best=0.0,float("inf")
    for k in range(max(1,int(np.floor(beat*1000)))):
        p=k/1000.0
        cost=sum(_circ(t,p,beat) for t in ons)
        if cost<best-PHASE_TIE_EPS: best,phase=cost,p
    beats,k=[],0
    while round(phase+k*beat,4)<dur:
        beats.append(round(phase+k*beat,4)); k+=1
    fi=lambda t:min(len(low)-1,max(0,int(round(t/hop_sec))))
    acc=[_mean([low[fi(beats[k])] for k in range(o,len(beats),BEATS_PER_BAR)]) for o in range(BEATS_PER_BAR)]
    off=int(np.argmax(acc))
    downs=[t for k,t in enumerate(beats) if k%BEATS_PER_BAR==off]
    offs=[_circ(t,phase,beat) for t in ons]
    grid={"bpm":bpm,"beat_sec":round(beat,6),"first_beat_sec":round(phase,4),"first_downbeat_sec":downs[0] if downs else round(phase,4),
          "beats_per_bar":BEATS_PER_BAR,"beats":len(beats),"bars":len(downs),"mean_offset_ms":round(_mean(offs)*1000,2),
          "on_beat_pct":round(100.0*sum(d<=ON_BEAT_TOL for d in offs)/len(ons),1)}
    return grid,beats,downs
def tension_curve(times,rn,cn,ons,hop_sec):
    n=len(times)
    if n==0: return []
    o=np.array(ons)
    dens=np.array([int(np.sum(np.abs(o-t)<=DENSITY_RADIUS)) if len(o) else 0 for t in times],dtype=float)
    dn=dens/dens.max() if dens.max()>0 else dens
    raw=0.5*np.array(rn)+0.3*np.array(cn)+0.2*dn
    r=max(1,int(round(SMOOTH_RADIUS/hop_sec)))
    sm=np.array([np.mean(raw[max(0,i-r):min(n,i+r+1)]) for i in range(n)])
    return (sm/(sm.max()+1e-12)).round(4).tolist()
def phrase_shape(v):
    t=len(v)//3
    if t==0: return "steady"
    a,b,c=_mean(v[:t]),_mean(v[t:len(v)-t]),_mean(v[len(v)-t:])
    if c-a>=SHAPE_THRESHOLD: return "build"
    if a-c>=SHAPE_THRESHOLD: return "release"
    if b-max(a,c)>=SHAPE_THRESHOLD: return "arc"
    return "steady"
def frames_in(times,start,end,last): return [i for i,t in enumerate(times) if t>=start and (t<end or (last and t<=end))]
def phrases(times,downs,tension,dur):
    if not downs: return []
    starts=[0.0]+[downs[k] for k in range(BARS_PER_PHRASE,len(downs),BARS_PER_PHRASE)]
    out=[]
    for i,st in enumerate(starts):
        last=i==len(starts)-1
        en=dur if last else starts[i+1]
        idx=frames_in(times,st,en,last)
        v=[tension[j] for j in idx]
        pk=int(np.argmax(v)) if v else 0
        out.append({"phrase":i+1,"start_sec":round(st,6),"end_sec":round(en,6),"duration_sec":round(en-st,6),
                    "bars":sum(st<=t<en for t in downs),"mean_tension":round(_mean(v),4),
                    "peak_tension":v[pk] if v else 0,"peak_sec":times[idx[pk]] if v else round(st,4),"shape":phrase_shape(v)})
    return out
def section_details(secs,times,rn,cn,tension,ons,fch):
    out=[]
    for i,s in enumerate(secs):
        last=i==len(secs)-1
        idx=frames_in(times,s["start_sec"],s["end_sec"],last)
        n_on=sum(t>=s["start_sec"] and (t<s["end_sec"] or (last and t<=s["end_sec"])) for t in ons)
        ch=np.sum([fch[j] for j in idx],axis=0) if idx else np.zeros(12)
        out.append({"section":s["section"],"energy":round(_mean([rn[j] for j in idx]),4),"brightness":round(_mean([cn[j] for j in idx]),4),
                    "tension":round(_mean([tension[j] for j in idx]),4),"onsets":n_on,
                    "onsets_per_sec":round(n_on/s["duration_sec"],3) if s["duration_sec"]>0 else 0,
                    "dominant_pitch":NOTES[int(np.argmax(ch))] if np.any(ch>0) else ""})
    return out
def read_mono(source, block_frames=1<<20):
    """Read audio as mono float32, downmixing in blocks so long multichannel
    files never sit in memory at full width. 16-bit PCM is exact in float32."""
    if isinstance(source,Path): source=str(source)
    with sf.SoundFile(source) as f:
        sr,ch,n=f.samplerate,f.channels,f.frames
        mono=np.empty(n,dtype=np.float32)
        pos=0
        while pos<n:
            block=f.read(min(block_frames,n-pos),dtype="float32",always_2d=True)
            if not len(block): break
            mono[pos:pos+len(block)]=block[:,0] if ch==1 else block.mean(axis=1,dtype=np.float64)
            pos+=len(block)
    return mono[:pos],sr
def analyze_audio(source, hop_ms=50, include_series=False, file_name=None):
    """Analyze a file path, or a file-like object (pass file_name for the report)."""
    if isinstance(source,(str,Path)):
        file_name=file_name or Path(source).name
    mono,sr=read_mono(source)
    return analyze_samples(mono,sr,file_name,hop_ms,include_series)
def analyze_samples(mono, sr, file_name=None, hop_ms=50, include_series=False):
    """Analyze mono samples (any float dtype) at sample rate sr."""
    dur=round(len(mono)/float(sr),6)
    hop=max(1,int(sr*(hop_ms/1000.0)))
    win=hop*2
    w=np.hanning(win)
    times,rv,cv,lv,fch=[],[],[],[],[]
    ch=np.zeros(12)
    freqs=np.fft.rfftfreq(win,d=1.0/sr)
    mask=(freqs>=55.0)&(freqs<=4186.0)
    lowmask=freqs<LOW_BAND_HZ
    pc=np.round(69.0+12.0*np.log2(freqs[mask]/440.0)).astype(int)%12
    for s in range(0,len(mono)-win+1,hop):
        fr=mono[s:s+win].astype(np.float64)
        times.append(round(s/float(sr),4))
        rv.append(float(np.sqrt(np.mean(fr**2))))
        mag=np.abs(np.fft.rfft(fr*w))
        cv.append(float(np.sum(freqs*mag)/(float(np.sum(mag))+1e-12)))
        lv.append(float(np.sum(mag[lowmask])))
        fc=np.bincount(pc,weights=mag[mask],minlength=12)
        ch+=fc; fch.append(fc)
    ra,ca=np.array(rv),np.array(cv)
    rn=(ra/(np.max(ra)+1e-12)).round(4).tolist()
    cn=(ca/(np.max(ca)+1e-12)).round(4).tolist()
    chn=(ch/(np.max(ch)+1e-12)).round(4).tolist()
    ed=np.maximum(0.0,np.diff(ra,prepend=ra[0]))
    pks,_=signal.find_peaks(ed,distance=max(1,int(0.25/(hop_ms/1000.0))),prominence=float(np.std(ed)*0.75))
    ons=[times[k] for k in pks]
    bpm=round(60.0/float(np.median(np.diff(ons))),2) if len(ons)>=2 else 0.0
    while bpm>180.0: bpm=round(bpm/2.0,2)
    while 0.0<bpm<65.0: bpm=round(bpm*2.0,2)
    secs,sl=[],dur/4.0
    for i in range(4):
        ss=round(i*sl,6)
        se=round(dur if i==3 else (i+1)*sl,6)
        secs.append({"section":i+1,"start_sec":ss,"end_sec":se,"duration_sec":round(se-ss,6)})
    err=round(abs(dur-sum(x["duration_sec"] for x in secs))*1000.0,4)
    hop_sec=hop/float(sr)
    tension=tension_curve(times,rn,cn,ons,hop_sec)
    bg=beat_grid(bpm,ons,dur,lv,hop_sec)
    phr=phrases(times,bg[2],tension,dur) if bg else []
    perr=round(abs(dur-sum(x["duration_sec"] for x in phr))*1000.0,4) if phr else 0
    detailed={"key":estimate_key(chn),"beat_grid":bg[0] if bg else None,"phrases":phr,
              "sections":section_details(secs,times,rn,cn,tension,ons,fch),
              "tension":{"mean":round(_mean(tension),4),"peak_sec":times[int(np.argmax(tension))] if tension else 0,
                         "low_sec":times[int(np.argmin(tension))] if tension else 0}}
    out={"track":{"file":file_name or "audio","sr":sr,"duration_sec":dur},"verified_math":{"bpm":bpm,"onsets":len(ons),"dominant_pitch":NOTES[int(np.argmax(chn))],"chroma":dict(zip(NOTES,chn)),"sections":secs},
         "detailed":detailed,"integrity":{"passed":err<=1.0 and perr<=1.0,"error_ms":err,"phrase_error_ms":perr}}
    if include_series:
        out["series"]={"times":times,"rms":rn,"centroid":cn,"onset_times":ons,"beat_times":bg[1] if bg else [],"downbeat_times":bg[2] if bg else [],"tension":tension}
    return out
if __name__=="__main__": print(json.dumps(analyze_audio(sys.argv[1]),indent=2))
