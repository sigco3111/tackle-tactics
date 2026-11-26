import math, os
from PIL import Image, ImageDraw
from gen_v1 import (S,OUT,SKIN,HAIR,SHIRT,SHORT,SOCK,BOOT,Canvas,seg,rect,ell,R)
import gen2, gen3
from gen3 import free, head, KSHIRT,KSHORT,KSOCK,GLOVE, slide_front
from gen2 import pol
CL=(SHIRT,SHORT,SOCK); CK=(KSHIRT,KSHORT,KSOCK)
# ---------- outfield: retimed so the whole action is inside the time the game shows it
def kick(i,n=8):
    # game shows ~500ms = frames 0..4 then falls back to idle
    f=[-5,-11,9,13,2,0,0,0][i]; l=[1,4,4,7,1,0,0,0][i]
    lean=[0,-1,1,2,0,0,0,0][i]; k=[-10,-28,32,45,8,0,0,0][i]
    return gen2.P(bob=0,lean=lean,leg=((f,l),(0,0)),arm=((k,40),(-k,40)))
# slide: 650ms = frames 0..5; rise must finish by frame 5, frames 6-9 = standing
SL=[ # hip,ang,legs,arms
 ((31,47),-28,((40,58),(25,57)),((-60,50),(30,60))),
 ((28,53),-62,((45,57),(30,58)),((-85,20),(40,40))),
 ((27,54),-70,((48,57),(33,58)),((-85,20),(70,30))),
 ((29,51),-45,((41,58),(26,58)),((-60,40),(30,50))),
 ((31,47),-20,((38,58),(26,58)),((-30,50),(30,50))),
 ((32,45),-6,((36,58),(28,58)),((-10,30),(10,30))),
]
def slide_side_i(i,flip=False):
    j=min(i,5)
    if i>=5: # standing hold = idle frame 0
        return side_idle(flip)
    h,a,l,ar=SL[j]; return free(h,a,l,ar,CL,'side',flip)
def side_idle(flip=False):
    img=gen2.side(gen2.idle(0)); return img.transpose(Image.FLIP_LEFT_RIGHT) if flip else img
def front_idle(back=False): return gen2.front(gen2.idle(0),back)
def slide_front_i(i,back=False):
    if i>=5: return front_idle(back)
    # map 6-step action onto drop/ext curves
    drop=[2,8,9,5,2][i]; ext=[1,6,7,3,1][i]
    return slide_front_curve(drop,ext,back)
def slide_front_curve(drop,ext,back):
    import types
    c=Canvas(); hipy=45+drop; top=32+drop
    def armf(sd,h):
        x=26 if sd<0 else 38; sh=(x,34+drop); hand=(x+sd*(4+h),sh[1]+6-h*0.4)
        el=((sh[0]+hand[0])/2,(sh[1]+hand[1])/2+1)
        c.part(seg(sh,el,4),SHIRT); c.part(seg(el,hand,3),SKIN); c.part(ell(hand[0]-1.5,hand[1]-1.5,hand[0]+1.5,hand[1]+1.5),SKIN,shade=False)
    fy=min(58,hipy+9)
    c.part(seg((29,hipy),(27,hipy+5),5),SKIN); c.part(seg((27,hipy+5),(28,fy),4),SOCK); c.part(rect(25,fy-1,31,fy+2,1),BOOT)
    c.part(rect(26,top,38,hipy,3),SHIRT); c.part(rect(26,hipy-4,38,hipy+3,1),SHORT)
    armf(-1,ext*0.8); armf(1,ext*0.8)
    foot=(37,min(59,hipy+8+ext)); big=1+ext//4
    c.part(seg((35,hipy),(36,(hipy+foot[1])/2),5),SKIN); c.part(seg((36,(hipy+foot[1])/2),(foot[0],foot[1]-2),4),SOCK)
    c.part(rect(foot[0]-3-big,foot[1]-2-big,foot[0]+3+big,foot[1]+1,1),BOOT)
    head(c,(32,22+drop),'back' if back else 'front')
    return c.render()
# ---------- keeper
def kfront(handsF,bob=0,crouch=0,lift=0,back=False,bigboot=False):
    c=Canvas(); hipy=45-bob+crouch; top=32-bob+crouch
    for sd in (-1,1):
        x=29 if sd<0 else 35; hip=(x,hipy); foot=(x+sd*(1+crouch*0.3),58-(lift if sd>0 else 0)); knee=((hip[0]+foot[0])/2+sd*(0.8+crouch*0.4),(hip[1]+foot[1])/2)
        c.part(seg(hip,knee,5),SKIN); c.part(seg(knee,(foot[0],foot[1]-2),4),KSOCK); c.part(rect(foot[0]-3,foot[1]-2,foot[0]+3,foot[1]+1,1),BOOT)
    c.part(rect(26,top,38,hipy,3),KSHIRT); c.part(rect(26,hipy-4,38,hipy+3,1),KSHORT)
    for sd,hd in zip((-1,1),handsF):
        x=26 if sd<0 else 38; sh=(x,34-bob+crouch); hand=(32+sd*hd[0] if hd[2] else x+sd*hd[0], sh[1]+hd[1])
        hand=(hand[0],max(4,hand[1])); el=((sh[0]+hand[0])/2+sd*1.2,(sh[1]+hand[1])/2)
        c.part(seg(sh,el,4),KSHIRT); c.part(seg(el,hand,3),SKIN); c.part(ell(hand[0]-2,hand[1]-2,hand[0]+2,hand[1]+2),GLOVE,shade=False)
    head(c,(32,22-bob+crouch),'back' if back else 'front')
    return c.render()
def kside(hip,ang,legs,arms,flip=False):
    img=free(hip,ang,legs,arms,CK,'side',False,kneedir=(1,1),glove=True)
    return img.transpose(Image.FLIP_LEFT_RIGHT) if flip else img
READY=((32,46),10,((37,58),(27,58)),((55,35),(45,35)))
def gk_ready(d,i):
    b=1 if 3<=i<9 else 0
    hip=(32,46+b*0); legs=((37,58),(27,58)); 
    if d in('right','left'):
        return kside((32,46+b),10,legs,((55,35),(45,35)),flip=(d=='left'))
    return kfront([(4,10,0),(4,10,0)] if False else [(7,8,0),(7,8,0)],bob=0,crouch=1+b,back=(d=='up'))
CATCH=[ # side: hip,ang,legs,arms
 READY,
 ((33,46),16,((38,58),(26,58)),((95,10),(90,10))),
 ((34,47),24,((40,58),(26,58)),((100,10),(95,10))),
 ((33,46),14,((38,58),(27,58)),((50,95),(45,95))),
 ((32,45),8,((36,58),(28,58)),((35,85),(30,85))),
 READY]
CF=[ [(7,8,0),(7,8,0)], [(5,2,0),(5,2,0)], [(3,0,0),(3,0,0)], [(3,9,1),(3,9,1)], [(3,10,1),(3,10,1)], [(7,8,0),(7,8,0)] ]
def gk_catch(d,i):
    if d in('right','left'):
        h,a,l,ar=CATCH[i]; return kside(h,a,l,ar,flip=(d=='left'))
    return kfront(CF[i],bob=[0,0,0,0,0,0][i],crouch=[1,2,3,2,1,1][i],back=(d=='up'))
PUNCH=[
 READY,
 ((32,47),6,((36,58),(28,58)),((-30,60),(60,35))),
 ((32,42),4,((34,54),(30,56)),((150,5),(60,35))),
 ((32,43),6,((35,55),(29,57)),((125,5),(55,35))),
 ((32,47),8,((37,58),(27,58)),((70,25),(50,35))),
 READY]
PF=[ [(7,8,0),(7,8,0)], [(8,12,0),(7,8,0)], [(6,-14,0),(7,8,0)], [(5,-6,0),(7,8,0)], [(7,6,0),(7,8,0)], [(7,8,0),(7,8,0)] ]
def gk_punch(d,i):
    if d in('right','left'):
        h,a,l,ar=PUNCH[i]; return kside(h,a,l,ar,flip=(d=='left'))
    return kfront(PF[i],bob=[0,0,5,4,0,0][i],crouch=[1,2,0,0,2,1][i],lift=[0,0,3,2,0,0][i],back=(d=='up'))
ANIM_GAME={'kick':(8,500),'slide_tackle':(10,650),'gk_ready':(12,None),'gk_catch':(6,700),'gk_punch':(6,700)}
def kick_d(d,i):
    fr=gen2.kick(i) if False else kick(i)
    return {'right':lambda:gen2.side(fr,True),'left':lambda:gen2.side(fr,False),'down':lambda:gen2.front(fr),'up':lambda:gen2.front(fr,True)}[d]()
def slide_d(d,i):
    return {'right':lambda:slide_side_i(i),'left':lambda:slide_side_i(i,True),'down':lambda:slide_front_i(i),'up':lambda:slide_front_i(i,True)}[d]()
def idle_d(d,i,keeper=False):
    return gk_ready(d,0) if keeper else gen2.DIRS[d](gen2.idle(0))
FN={'kick':kick_d,'slide_tackle':slide_d,'gk_ready':gk_ready,'gk_catch':gk_catch,'gk_punch':gk_punch}
def diff(a,b):
    pa,pb=a.load(),b.load(); n=0
    for y in range(S):
        for x in range(S):
            if pa[x,y]!=pb[x,y]: n+=1
    return n
if __name__=='__main__':
    ob='/downloads/sample/final_blue'; kb='/downloads/sample/final_keeper_pink'
    os.makedirs(ob,exist_ok=True); os.makedirs(kb,exist_ok=True)
    for a,(n,ms) in ANIM_GAME.items():
        for d in ['down','up','left','right']:
            st=Image.new('RGBA',(S*n,S),(0,0,0,0))
            for i in range(n): st.paste(FN[a](d,i),(i*S,0))
            st.save(f"{kb if a.startswith('gk') else ob}/{a}_{d}.png")
    # pop check: frame shown at the cut vs resting pose
    print('anim,dir,last_visible_frame,pixel_diff_vs_rest(of 4096)')
    for a,(n,ms) in ANIM_GAME.items():
        if ms is None: continue
        k=min(n-1,int(ms//110)) if ms<n*110 else n-1
        keeper=a.startswith('gk')
        for d in ['down','up','left','right']:
            last=FN[a](d,k); rest=idle_d(d,0,keeper)
            print(a,d,k,diff(last,rest))
    G=(70,150,70,255)
    for a,(n,ms) in ANIM_GAME.items():
        z=Image.new('RGBA',(max(n,8)*112,112*4),G)
        for r,d in enumerate(['right','left','down','up']):
            for i in range(n): z.alpha_composite(FN[a](d,i).resize((112,112),Image.NEAREST),(i*112,r*112))
        z.save(f'/downloads/sample/final_{a}_sheet.png')
